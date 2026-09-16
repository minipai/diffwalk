import { createHash } from 'node:crypto'
import { diffLines, formatPatch, structuredPatch, type StructuredPatch } from 'diff'
import type {
  BinaryChangeBlock,
  CaptureSource,
  ChangeBlock,
  ChangeSide,
  DraftFile,
  DocumentStep,
  ExplanationStep,
  ExplainCapture,
  ExplainDocument,
  Explanations,
  TextChangeBlock,
} from '../format/types'
import { excludedSide, isMovedStatus } from '../format/status'

export function createExplainCapture(files: DraftFile[], source: CaptureSource): ExplainCapture {
  let nextId = 1
  const changes: ChangeBlock[] = []

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (file.oldBinary !== undefined || file.newBinary !== undefined || isMovedStatus(file.status)) {
      changes.push(binaryChangeBlock(file, changeId(nextId++)))
      continue
    }

    const fileChanges = changeBlocks(file).map((change) => ({
      kind: 'text' as const,
      id: changeId(nextId++),
      path: file.path,
      ...change,
    }))

    if (fileChanges.length === 0 && file.status !== 'modified') {
      fileChanges.push({
        kind: 'text',
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

  return {
    captureId: captureIdFor(files),
    source,
    files,
    changes,
  }
}

function binaryChangeBlock(file: DraftFile, id: string): BinaryChangeBlock {
  const before = changeSide(file, 'old')
  const after = changeSide(file, 'new')
  return {
    kind: 'binary',
    id,
    path: file.path,
    status: file.status,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    ...(file.excludedPath === undefined ? {} : { excludedPath: file.excludedPath }),
    oldMode: file.oldMode,
    newMode: file.newMode,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  }
}

// Every existing side has an identity, whether its bytes decode as text or stay binary, so a
// text-to-binary or binary-to-text transition keeps both sides instead of dropping one. A
// side omitted by an exclusion is absent here too, but its status says why, so a renderer
// never mistakes it for an empty file.
function changeSide(file: DraftFile, side: 'old' | 'new'): ChangeSide | undefined {
  const absent =
    side === 'old'
      ? file.status === 'added' || excludedSide(file.status) === 'old'
      : file.status === 'deleted' || excludedSide(file.status) === 'new'
  if (absent) return undefined

  const binary = side === 'old' ? file.oldBinary : file.newBinary
  if (binary !== undefined) return { kind: 'binary', size: binary.size, hash: binary.hash }

  const content = side === 'old' ? file.oldContent : file.newContent
  return {
    kind: 'text',
    size: Buffer.byteLength(content, 'utf8'),
    hash: createHash('sha256').update(content).digest('hex'),
  }
}

export function captureIdFor(files: DraftFile[], includeModes = true): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.status)
    hash.update('\0')
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.oldPath ?? '')
    hash.update('\0')
    // Only a rename crossing an exclusion has an excluded path, so files without one keep
    // the capture ID they had before this field existed.
    if (file.excludedPath !== undefined) {
      hash.update(`excluded:${file.excludedPath}`)
      hash.update('\0')
    }
    if (includeModes) {
      hash.update(file.oldMode)
      hash.update('\0')
      hash.update(file.newMode)
      hash.update('\0')
    }
    hash.update(file.oldContent)
    hash.update('\0')
    hash.update(file.newContent)
    hash.update('\0')
    // Binary sides keep their bytes out of the capture, so their size and content hash must
    // carry the identity instead. Text-only files hash exactly as they did before this field,
    // keeping existing captures and their explanations matched.
    if (file.oldBinary !== undefined) {
      hash.update(`old-binary:${file.oldBinary.size}:${file.oldBinary.hash}`)
      hash.update('\0')
    }
    if (file.newBinary !== undefined) {
      hash.update(`new-binary:${file.newBinary.size}:${file.newBinary.hash}`)
      hash.update('\0')
    }
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
      for (const changeId of step.changes ?? []) {
        if (seen.has(changeId)) repeated.add(changeId)
        seen.add(changeId)
      }
    }
  }
  return [...repeated].sort()
}

export function materializeExplainDocument(
  capture: ExplainCapture,
  explanations: Explanations,
): ExplainDocument {
  validateCapturePair(capture, explanations)
  const filesByPath = new Map(capture.files.map((file) => [file.path, file]))
  const changesById = new Map(capture.changes.map((change) => [change.id, change]))

  const shown = new Set<string>()
  const sections = explanations.sections.map((section) => ({
    title: section.title,
    steps: section.steps.map((step) => materializeStep(step, filesByPath, changesById, shown)),
  }))

  validateChangeCoverage(capture.changes, shown)

  return {
    formatVersion: 1,
    title: explanations.title,
    summary: explanations.summary,
    source: capture.source,
    ...(explanations.metadata === undefined ? {} : { metadata: explanations.metadata }),
    sections,
  }
}

function materializeStep(
  step: ExplanationStep,
  filesByPath: Map<string, DraftFile>,
  changesById: Map<string, ChangeBlock>,
  shown: Set<string>,
): DocumentStep {
  if (step.changes === undefined) {
    return { text: step.text }
  } else {
    const selected = step.changes.map((changeId) => {
      const change = findChange(changesById, changeId)
      shown.add(changeId)
      return change
    })

    const textChanges = selected.filter(
      (change): change is TextChangeBlock => change.kind === 'text',
    )
    const binaryChanges = selected.filter(
      (change): change is BinaryChangeBlock => change.kind === 'binary',
    )
    for (const change of binaryChanges) validateBinaryChange(change, filesByPath)

    const changesByPath = new Map<string, TextChangeBlock[]>()
    for (const change of textChanges) {
      const fileChanges = changesByPath.get(change.path) ?? []
      fileChanges.push(change)
      changesByPath.set(change.path, fileChanges)
    }

    const patches: StructuredPatch[] = []
    for (const [path, fileChanges] of changesByPath) {
      const file = findFile(filesByPath, path)
      patches.push(createFilePatch(file, fileChanges))
    }

    return {
      text: step.text,
      ...(patches.length === 0 ? {} : { diff: patches.map(formatFilePatch).join('\n') }),
      ...(binaryChanges.length === 0 ? {} : { binary: binaryChanges }),
      changes: step.changes,
    }
  }
}

// A binary change carries no patch to re-derive, so materialization re-reads the file and
// confirms the captured sizes, hashes, status, and modes still describe it.
function validateBinaryChange(change: BinaryChangeBlock, filesByPath: Map<string, DraftFile>): void {
  const file = findFile(filesByPath, change.path)
  if (file.oldBinary === undefined && file.newBinary === undefined && !isMovedStatus(file.status)) {
    throw new Error(`Change block no longer matches captured file content: ${change.id}`)
  }
  const expected = binaryChangeBlock(file, change.id)
  if (
    expected.status !== change.status ||
    expected.oldPath !== change.oldPath ||
    expected.excludedPath !== change.excludedPath ||
    expected.oldMode !== change.oldMode ||
    expected.newMode !== change.newMode ||
    JSON.stringify(expected.before) !== JSON.stringify(change.before) ||
    JSON.stringify(expected.after) !== JSON.stringify(change.after)
  ) {
    throw new Error(`Change block no longer matches captured file content: ${change.id}`)
  }
}

function findChange(changesById: Map<string, ChangeBlock>, changeId: string): ChangeBlock {
  const change = changesById.get(changeId)
  if (!change) throw new Error(`Unknown change ID: ${changeId}`)
  return change
}

function findFile(filesByPath: Map<string, DraftFile>, filePath: string): DraftFile {
  const file = filesByPath.get(filePath)
  if (!file) throw new Error(`Change references missing file: ${filePath}`)
  return file
}

function validateCapturePair(capture: ExplainCapture, explanations: Explanations): void {
  if (capture.captureId !== explanations.captureId) {
    throw new Error(stalePairingMessage(capture, explanations))
  }
  if (capture.changes.length === 0 && explanations.sections.length === 0) {
    throw new Error('No captured changes or authored sections to materialize; nothing to view, export, or publish.')
  }
  if (new Set(capture.changes.map((change) => change.id)).size !== capture.changes.length) {
    throw new Error('Capture contains duplicate change IDs')
  }
}

function validateChangeCoverage(changes: ChangeBlock[], shown: Set<string>): void {
  const unshown = changes.filter((change) => !shown.has(change.id))
  if (unshown.length > 0) {
    throw new Error(`Unassigned change IDs: ${unshown.map((change) => change.id).join(', ')}`)
  }
}

function changeBlocks(file: DraftFile): Omit<TextChangeBlock, 'kind' | 'id' | 'path'>[] {
  const parts = diffLines(file.oldContent, file.newContent)
  const changes: Omit<TextChangeBlock, 'kind' | 'id' | 'path'>[] = []
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

function createFilePatch(file: DraftFile, changes: TextChangeBlock[]): StructuredPatch {
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
  if (file.oldMode !== file.newMode) {
    patch.oldMode = file.oldMode
    patch.newMode = file.newMode
  }
  return patch
}

function formatFilePatch(patch: StructuredPatch): string {
  const formatted = formatPatch(patch)
  if (!patch.isRename || patch.hunks.length > 0) return formatted
  return formatted.replace('\nrename from ', '\nsimilarity index 100%\nrename from ')
}

function validateBlocks(file: DraftFile, changes: TextChangeBlock[]) {
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
