import { existsSync } from 'node:fs'
import { z } from 'zod'
import { captureIdFor, createExplainCapture } from '../../authoring/capture'
import {
  authoringFiles,
  explanationsSkeleton,
  readCapture,
  writeCapture,
  writeJson,
  writeText,
} from '../../authoring/input'
import type { ExplainCapture } from '../../format'
import { captureGitChanges, captureGitRevisionChanges, commitForRevision } from '../../authoring/git'
import { UsageError } from '../usage'
import { currentWalkIfPresent, setCurrentWalk, walkId, walkPaths } from '../../authoring/walk'

export const inspectOptionsSchema = z.object({
  base: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  output: z.string().optional(),
  explanations: z.string().optional(),
})
type InspectOptions = z.infer<typeof inspectOptionsSchema>

export async function inspectCommand(
  revision: string | undefined,
  options: InspectOptions,
): Promise<void> {
  const capturedAt = new Date().toISOString()
  const { base, from, to } = options
  if (from !== undefined || to !== undefined) {
    if (from === undefined || to === undefined) {
      throw new UsageError('Pass both --from and --to for a committed revision range')
    }
    if (base !== undefined || revision !== undefined) {
      throw new UsageError('Do not combine --from/--to with --base or a positional revision')
    }
    const git = await captureGitRevisionChanges(from, to)
    const capture = createExplainCapture(git.files, {
      kind: 'commit-diff',
      from: { revision: from, commit: git.fromCommit },
      to: { revision: to, commit: git.toCommit },
      capturedAt,
    })
    await finishInspect(options, capture, capturedAt)
    return
  }
  if (revision !== undefined && base !== undefined) {
    throw new UsageError('Do not combine a positional commit revision with --base')
  }
  if (revision !== undefined) {
    const commit = await commitForRevision(revision)
    const parent = await firstParent(commit)
    const git = await captureGitRevisionChanges(`${revision}^1`, revision)
    const capture = createExplainCapture(git.files, {
      kind: 'commit-diff',
      from: { revision: `${revision}^1`, commit: parent },
      to: { revision, commit },
      capturedAt,
    })
    await finishInspect(options, capture, capturedAt)
    return
  }
  const resolvedBase = base ?? 'HEAD'
  const git = await captureGitChanges(resolvedBase)
  const capture = createExplainCapture(git.files, {
    kind: 'working-tree',
    from: { revision: resolvedBase, commit: git.baseCommit },
    capturedAt,
  })
  await finishInspect(options, capture, capturedAt)
}

async function finishInspect(
  options: InspectOptions,
  capture: ExplainCapture,
  capturedAt: string,
): Promise<void> {
  const { output: outputOverride, explanations: explanationsOverride } = options

  if (outputOverride !== undefined || explanationsOverride !== undefined) {
    const paths = authoringFiles(outputOverride, explanationsOverride)
    await writeCapture(paths, capture)
    console.log(
      `Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}`,
    )
    console.log(
      `Next: edit ${paths.explanations}, then run \`diffwalk check --input ${paths.capture} --explanations ${paths.explanations}\`.`,
    )
    return
  }

  const previous = await currentWalkIfPresent()
  if (previous !== null) {
    const previousCapture = await readCapture(previous.capture)
    const previousLegacyId = captureIdFor(previousCapture.files, false)
    const modesAreLegacyCompatible = capture.files.every((file) =>
      file.status === 'added'
        ? file.oldMode === '000000' && file.newMode === '100644'
        : file.status === 'deleted'
          ? file.oldMode === '100644' && file.newMode === '000000'
          : file.oldMode === file.newMode,
    )
    const sameCapture = previousCapture.captureId === capture.captureId ||
      (modesAreLegacyCompatible && previousCapture.captureId === previousLegacyId &&
        previousLegacyId === captureIdFor(capture.files, false))
    if (sameCapture && sourceIdentity(previousCapture.source) === sourceIdentity(capture.source)) {
      if (existsSync(previous.explanations)) {
        console.log(`Kept existing ${previous.explanations} (inspect never overwrites it)`)
      } else {
        await writeText(previous.explanations, explanationsSkeleton(capture.captureId))
        console.log(`Wrote a ${previous.explanations} skeleton to author`)
      }
      console.log(
        `${capture.source.kind === 'working-tree' ? 'Working tree' : 'Capture'} is unchanged; kept current walk ${previous.id}`,
      )
      console.log(`Next: edit ${previous.explanations}, then run \`diffwalk check\`.`)
      return
    }
  }

  const id = walkId(capturedAt, capture.captureId)
  const paths = walkPaths(id)
  if (existsSync(paths.capture)) {
    const existing = await readCapture(paths.capture)
    if (existing.captureId !== capture.captureId || sourceIdentity(existing.source) !== sourceIdentity(capture.source)) {
      throw new Error(`Walk ID collision at ${paths.directory}`)
    }
  } else {
    await writeJson(paths.capture, capture)
  }

  if (existsSync(paths.explanations)) {
    console.log(`Kept existing ${paths.explanations} (inspect never overwrites it)`)
  } else {
    await writeText(paths.explanations, explanationsSkeleton(capture.captureId))
    console.log(`Wrote a ${paths.explanations} skeleton to author`)
  }
  await setCurrentWalk(id)
  console.log(
    `Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}`,
  )
  console.log(`Current walk: ${id}`)
  console.log(`Next: edit ${paths.explanations}, then run \`diffwalk check\`.`)
}

function sourceIdentity(source: ExplainCapture['source']): string {
  return JSON.stringify({
    kind: source.kind,
    from: source.from,
    ...(source.kind === 'commit-diff' ? { to: source.to } : {}),
  })
}

async function firstParent(commit: string): Promise<string> {
  try {
    return await commitForRevision(`${commit}^1`)
  } catch {
    throw new Error(
      `Revision ${commit} is a root commit and has no first parent; use inspect --from <revision> --to <revision> instead.`,
    )
  }
}
