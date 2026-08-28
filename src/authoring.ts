import { formatPatch, structuredPatch, type StructuredPatch } from 'diff'
import { parseDiffFromFile } from 'hunkdiff/opentui'
import {
  explainDocumentSchema,
  explainDraftSchema,
  type ChangeBlock,
  type DraftFile,
  type ExplainDocument,
  type ExplainDraft,
} from './format'

export function createExplainDraft(
  files: DraftFile[],
  source: ExplainDraft['source'],
): ExplainDraft {
  let nextId = 1
  const changes: ChangeBlock[] = []

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const metadata = parseDiffFromFile(
      file.oldContent === '' && file.status === 'added'
        ? null
        : { name: file.oldPath ?? file.path, contents: file.oldContent },
      file.newContent === '' && file.status === 'deleted'
        ? null
        : { name: file.path, contents: file.newContent },
      { context: 3 },
      true,
    )
    const fileChanges: ChangeBlock[] = []

    for (const hunk of metadata.hunks) {
      for (const content of hunk.hunkContent) {
        if (content.type !== 'change') continue
        const oldIndex = Math.max(0, content.deletionLineIndex)
        const newIndex = Math.max(0, content.additionLineIndex)
        fileChanges.push({
          id: changeId(nextId++),
          path: file.path,
          oldStart: oldIndex + 1,
          oldCount: content.deletions,
          newStart: newIndex + 1,
          newCount: content.additions,
          before: metadata.deletionLines
            .slice(oldIndex, oldIndex + content.deletions)
            .join(''),
          after: metadata.additionLines
            .slice(newIndex, newIndex + content.additions)
            .join(''),
        })
      }
    }

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

  return explainDraftSchema.parse({
    draftVersion: 1,
    source,
    files,
    changes,
    sections: [],
  })
}

export function buildExplainDocument(input: unknown): ExplainDocument {
  const draft = explainDraftSchema.parse(input)
  const filesByPath = new Map(draft.files.map((file) => [file.path, file]))
  const changesById = new Map(draft.changes.map((change) => [change.id, change]))
  if (changesById.size !== draft.changes.length) throw new Error('Draft contains duplicate change IDs')

  const assigned = new Set<string>()
  const sections = draft.sections.map((section) => {
    const selected = section.changes.map((id) => {
      const change = changesById.get(id)
      if (!change) throw new Error(`Unknown change ID: ${id}`)
      if (assigned.has(id)) throw new Error(`Change ID is assigned more than once: ${id}`)
      assigned.add(id)
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

    return {
      explain: section.explain,
      diff: formatPatch(patches),
    }
  })

  const unassigned = draft.changes.filter((change) => !assigned.has(change.id))
  if (unassigned.length > 0) {
    throw new Error(`Unassigned change IDs: ${unassigned.map((change) => change.id).join(', ')}`)
  }

  return explainDocumentSchema.parse({
    formatVersion: 1,
    source: draft.source,
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
