import type { HunkDiffFile } from 'hunkdiff/opentui'
import type { ExplainSection } from './document'

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
