import { createHash } from 'node:crypto'
import { diffLines, formatPatch, structuredPatch, type StructuredPatch } from 'diff'
import {
  captureSchema,
  explainDocumentSchema,
  type CaptureSource,
  type ChangeBlock,
  type DraftFile,
  type ExplainCapture,
  type ExplainDocument,
  type Explanations,
} from './format'

export function createExplainCapture(files: DraftFile[], source: CaptureSource): ExplainCapture {
  let nextId = 1
  const changes: ChangeBlock[] = []

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const fileChanges = changeBlocks(file).map((change) => ({
      id: changeId(nextId++),
      path: file.path,
      ...change,
    }))

    if (fileChanges.length === 0 && file.status !== 'modified') {
      fileChanges.push({
        id: changeId(nextId++),
        path: file.path,
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: 0,
        before: '',
        after: '',
      })
    }

    changes.push(...fileChanges)
  }

  return captureSchema.parse({
    captureId: captureIdFor(files),
    source,
    files,
    changes,
  })
}

function changeBlocks(file: DraftFile): Omit<ChangeBlock, 'id' | 'path'>[] {
  const parts = diffLines(file.oldContent, file.newContent)
  const changes: Omit<ChangeBlock, 'id' | 'path'>[] = []
  let oldIndex = 0
  let newIndex = 0

  for (let index = 0; index < parts.length;) {
    const part = parts[index]!
    if (!part.added && !part.removed) {
      oldIndex += part.count ?? 0
      newIndex += part.count ?? 0
      index++
      continue
    }

    const oldStart = oldIndex + 1
    const newStart = newIndex + 1
    let before = ''
    let after = ''
    let oldCount = 0
    let newCount = 0

    while (index < parts.length) {
      const changed = parts[index]!
      if (!changed.added && !changed.removed) break
      const count = changed.count ?? 0
      if (changed.removed) {
        before += changed.value
        oldCount += count
        oldIndex += count
      } else {
        after += changed.value
        newCount += count
        newIndex += count
      }
      index++
    }

    changes.push({ oldStart, oldCount, newStart, newCount, before, after })
  }

  return changes
}

export function captureIdFor(files: DraftFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.status)
    hash.update('\0')
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.oldPath ?? '')
    hash.update('\0')
    hash.update(file.oldContent)
    hash.update('\0')
    hash.update(file.newContent)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function stalePairingMessage(capture: ExplainCapture, explanations: Explanations): string {
  return `The explanations target capture ${explanations.captureId} but capture.json holds ${capture.captureId}. The files come from different walks or the captured contents changed after the explanations were authored. Use capture.json and explanations.yaml from the same .diffwalk walk, or run \`diffwalk inspect\` for a fresh current pair.`
}

export function duplicatedChangeIds(explanations: Explanations): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const section of explanations.sections) {
    for (const step of section.steps) {
      for (const id of step.changes ?? []) {
        if (seen.has(id)) repeated.add(id)
        seen.add(id)
      }
    }
  }
  return [...repeated].sort()
}

export function materializeExplainDocument(
  capture: ExplainCapture,
  explanations: Explanations,
): ExplainDocument {
  if (capture.captureId !== explanations.captureId) {
    throw new Error(stalePairingMessage(capture, explanations))
  }

  if (capture.changes.length === 0 && explanations.sections.length === 0) {
    throw new Error('No captured changes or authored sections to materialize; nothing to view, export, or publish.')
  }

  const filesByPath = new Map(capture.files.map((file) => [file.path, file]))
  const changesById = new Map(capture.changes.map((change) => [change.id, change]))
  if (changesById.size !== capture.changes.length) {
    throw new Error('Capture contains duplicate change IDs')
  }

  const shown = new Set<string>()
  const sections = explanations.sections.map((section) => ({
    title: section.title,
    steps: section.steps.map((step) => {
      if (step.changes === undefined) return { text: step.text }

      const selected = step.changes.map((id) => {
        const change = changesById.get(id)
        if (!change) throw new Error(`Unknown change ID: ${id}`)
        shown.add(id)
        return change
      })

      const changesByPath = new Map<string, ChangeBlock[]>()
      for (const change of selected) {
        const fileChanges = changesByPath.get(change.path) ?? []
        fileChanges.push(change)
        changesByPath.set(change.path, fileChanges)
      }

      const patches: StructuredPatch[] = []
      for (const [path, fileChanges] of changesByPath) {
        const file = filesByPath.get(path)
        if (!file) throw new Error(`Change references missing file: ${path}`)
        patches.push(createFilePatch(file, fileChanges))
      }

      return { text: step.text, diff: formatPatch(patches) }
    }),
  }))

  const unshown = capture.changes.filter((change) => !shown.has(change.id))
  if (unshown.length > 0) {
    throw new Error(`Unassigned change IDs: ${unshown.map((change) => change.id).join(', ')}`)
  }

  return explainDocumentSchema.parse({
    formatVersion: 1,
    title: explanations.title,
    summary: explanations.summary,
    source: capture.source,
    sections,
  })
}

function createFilePatch(file: DraftFile, changes: ChangeBlock[]): StructuredPatch {
  validateBlocks(file, changes)
  const nextLines = splitLines(file.oldContent)

  for (const change of [...changes].sort(
    (left, right) => right.oldStart - left.oldStart || right.newStart - left.newStart,
  )) {
    nextLines.splice(change.oldStart - 1, change.oldCount, ...splitLines(change.after))
  }

  const oldName = file.status === 'added' ? '/dev/null' : `a/${file.oldPath ?? file.path}`
  const newName = file.status === 'deleted' ? '/dev/null' : `b/${file.path}`
  const patch = structuredPatch(oldName, newName, file.oldContent, nextLines.join(''), undefined, undefined, {
    context: 3,
  })
  patch.isGit = true
  patch.isCreate = file.status === 'added'
  patch.isDelete = file.status === 'deleted'
  patch.isRename = file.status === 'renamed'
  return patch
}

function validateBlocks(file: DraftFile, changes: ChangeBlock[]) {
  const oldLines = splitLines(file.oldContent)
  const newLines = splitLines(file.newContent)
  const sorted = [...changes].sort((left, right) => left.oldStart - right.oldStart)

  for (const [index, change] of sorted.entries()) {
    const before = oldLines.slice(change.oldStart - 1, change.oldStart - 1 + change.oldCount).join('')
    const after = newLines.slice(change.newStart - 1, change.newStart - 1 + change.newCount).join('')
    if (before !== change.before || after !== change.after) {
      throw new Error(`Change block no longer matches captured file content: ${change.id}`)
    }

    const previous = sorted[index - 1]
    if (
      previous &&
      previous.oldCount > 0 &&
      change.oldCount > 0 &&
      previous.oldStart - 1 + previous.oldCount > change.oldStart - 1
    ) {
      throw new Error(`Overlapping change blocks for ${file.path}`)
    }
  }
}

function splitLines(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function changeId(value: number) {
  return `change-${String(value).padStart(3, '0')}`
}
