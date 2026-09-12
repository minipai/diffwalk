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
} from '../input'
import type { ExplainCapture } from '../../format/types'
import { captureGitChanges, captureGitRevisionChanges, commitForRevision } from '../../authoring/git'
import { UsageError } from '../usage'
import { currentWalkIfPresent, setCurrentWalk, walkId, walkPaths } from '../../authoring/walk'

const inspectOptionsSchema = z.object({
  staged: z.boolean().default(false),
  base: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  output: z.string().optional(),
  explanations: z.string().optional(),
})
type InspectOptions = z.infer<typeof inspectOptionsSchema>

export async function inspectChanges(
  revision: string | undefined,
  options: z.input<typeof inspectOptionsSchema>,
  paths: string[] = [],
): Promise<void> {
  const { base, from, to, staged, output, explanations } = inspectOptionsSchema.parse(options)
  validateCaptureOptions(revision, { base, from, to, staged }, paths)
  const capturedAt = new Date().toISOString()
  const capture = await captureChanges(revision, { base, from, to, staged }, paths, capturedAt)
  await saveCapture(capture, { output, explanations }, capturedAt)
}

function validateCaptureOptions(
  revision: string | undefined,
  { base, from, to, staged }: Pick<InspectOptions, 'base' | 'from' | 'to' | 'staged'>,
  paths: string[],
): void {
  if (from !== undefined || to !== undefined) {
    if (from === undefined || to === undefined) {
      throw new UsageError('Pass both --from and --to for a committed revision range')
    }
    if (base !== undefined || revision !== undefined) {
      throw new UsageError('Do not combine --from/--to with --base or a positional revision')
    }
    if (paths.length > 0) {
      throw new UsageError('Path limiting applies only to working-tree captures')
    }
    if (staged) {
      throw new UsageError('Do not combine --staged with --from/--to')
    }
  } else if (revision !== undefined) {
    if (base !== undefined) {
      throw new UsageError('Do not combine a positional commit revision with --base')
    }
    if (paths.length > 0) {
      throw new UsageError('Path limiting applies only to working-tree captures')
    }
    if (staged) {
      throw new UsageError('Do not combine --staged with a positional commit revision')
    }
  }
}

async function captureChanges(
  revision: string | undefined,
  { base, from, to, staged }: Pick<InspectOptions, 'base' | 'from' | 'to' | 'staged'>,
  paths: string[],
  capturedAt: string,
): Promise<ExplainCapture> {
  if (from !== undefined && to !== undefined) {
    const git = await captureGitRevisionChanges(from, to)
    return createExplainCapture(git.files, {
      kind: 'commit-diff',
      from: { revision: from, commit: git.fromCommit },
      to: { revision: to, commit: git.toCommit },
      capturedAt,
    })
  } else if (revision !== undefined) {
    const commit = await commitForRevision(revision)
    const parent = await firstParent(commit)
    const git = await captureGitRevisionChanges(`${revision}^1`, revision)
    return createExplainCapture(git.files, {
      kind: 'commit-diff',
      from: { revision: `${revision}^1`, commit: parent },
      to: { revision, commit },
      capturedAt,
    })
  } else {
    const resolvedBase = base ?? 'HEAD'
    const git = await captureGitChanges(resolvedBase, process.cwd(), { staged, paths })
    return createExplainCapture(git.files, {
      kind: 'working-tree',
      from: { revision: resolvedBase, commit: git.baseCommit },
      capturedAt,
    })
  }
}

async function saveCapture(
  capture: ExplainCapture,
  { output: outputOverride, explanations: explanationsOverride }: Pick<InspectOptions, 'output' | 'explanations'>,
  capturedAt: string,
): Promise<void> {
  if (outputOverride !== undefined || explanationsOverride !== undefined) {
    const paths = authoringFiles(outputOverride, explanationsOverride)
    await writeCapture(paths, capture)
    console.log(`Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}
Next: edit ${paths.explanations}, then run \`diffwalk check --input ${paths.capture} --explanations ${paths.explanations}\`.`)
  } else {
    await saveWalk(capture, capturedAt)
  }
}

async function saveWalk(capture: ExplainCapture, capturedAt: string): Promise<void> {
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
      console.log(`${capture.source.kind === 'working-tree' ? 'Working tree' : 'Capture'} is unchanged; kept current walk ${previous.id}
Next: edit ${previous.explanations}, then run \`diffwalk check\`.`)
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
  console.log(`Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}
Current walk: ${id}
Next: edit ${paths.explanations}, then run \`diffwalk check\`.`)
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
