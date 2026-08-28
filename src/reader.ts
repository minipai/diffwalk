import type { HunkDiffFile } from 'hunkdiff/opentui'
import type { ExplainSection } from './document'

export interface ReaderCursor {
  sectionId: string
  path: string | null
}

export interface ReaderFoldState {
  explanations: ReadonlySet<string>
  files: ReadonlySet<string>
}

export function createFoldState(): ReaderFoldState {
  return { explanations: new Set(), files: new Set() }
}

export function filePath(file: HunkDiffFile): string {
  return file.path ?? file.metadata.name
}

export function fileKey(sectionId: string, filePathValue: string): string {
  return `${sectionId}/${filePathValue}`
}

export function isExplainFolded(state: ReaderFoldState, sectionId: string): boolean {
  return state.explanations.has(sectionId)
}

export function isFileFolded(state: ReaderFoldState, sectionId: string, filePathValue: string): boolean {
  return state.files.has(fileKey(sectionId, filePathValue))
}

export function toggleExplanation(state: ReaderFoldState, sectionId: string): ReaderFoldState {
  return { ...state, explanations: toggled(state.explanations, sectionId) }
}

export function toggleFile(state: ReaderFoldState, sectionId: string, filePathValue: string): ReaderFoldState {
  return { ...state, files: toggled(state.files, fileKey(sectionId, filePathValue)) }
}

function toggled(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export interface ExplainTreeRow {
  kind: 'explain'
  section: ExplainSection
  folded: boolean
}

export interface FileTreeRow {
  kind: 'file'
  sectionId: string
  file: HunkDiffFile
  folded: boolean
}

export type ReaderTreeRow = ExplainTreeRow | FileTreeRow

export function visibleTreeRows(sections: ExplainSection[], state: ReaderFoldState): ReaderTreeRow[] {
  const rows: ReaderTreeRow[] = []
  for (const section of sections) {
    const folded = isExplainFolded(state, section.id)
    rows.push({ kind: 'explain', section, folded })
    if (folded) continue
    for (const file of section.files) {
      rows.push({
        kind: 'file',
        sectionId: section.id,
        file,
        folded: isFileFolded(state, section.id, filePath(file)),
      })
    }
  }
  return rows
}

export function cursorOfRow(row: ReaderTreeRow): ReaderCursor {
  if (row.kind === 'explain') return { sectionId: row.section.id, path: null }
  return { sectionId: row.sectionId, path: filePath(row.file) }
}

export function cursorIndex(rows: ReaderTreeRow[], cursor: ReaderCursor | null): number {
  if (rows.length === 0) return -1
  if (cursor === null) return 0
  const direct = rows.findIndex(
    (row) =>
      cursorOfRow(row).sectionId === cursor.sectionId && cursorOfRow(row).path === cursor.path,
  )
  if (direct !== -1) return direct
  const ancestor = rows.findIndex(
    (row) => row.kind === 'explain' && row.section.id === cursor.sectionId,
  )
  return ancestor === -1 ? 0 : ancestor
}

export function moveCursor(
  rows: ReaderTreeRow[],
  cursor: ReaderCursor | null,
  delta: number,
): ReaderCursor | null {
  if (rows.length === 0) return cursor
  const target = Math.max(0, Math.min(rows.length - 1, cursorIndex(rows, cursor) + delta))
  return cursorOfRow(rows[target]!)
}

export function toggleRow(state: ReaderFoldState, row: ReaderTreeRow): ReaderFoldState {
  if (row.kind === 'explain') return toggleExplanation(state, row.section.id)
  return toggleFile(state, row.sectionId, filePath(row.file))
}

export function rowId(row: ReaderTreeRow): string {
  if (row.kind === 'explain') return row.section.id
  return fileKey(row.sectionId, filePath(row.file))
}
