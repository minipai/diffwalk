import type { HunkDiffFile } from 'hunkdiff/opentui'
import type { ExplainSection, ExplainStep } from './document'

export interface ReaderCursor {
  sectionId: string
  stepId: string | null
  path: string | null
}

export interface ReaderFoldState {
  explanations: ReadonlySet<string>
  steps: ReadonlySet<string>
  files: ReadonlySet<string>
}

export function createFoldState(): ReaderFoldState {
  return { explanations: new Set(), steps: new Set(), files: new Set() }
}

export function filePath(file: HunkDiffFile): string {
  return file.path ?? file.metadata.name
}

export function fileKey(stepId: string, filePathValue: string): string {
  return `${stepId}/${filePathValue}`
}

export function sectionFileCount(section: ExplainSection): number {
  return section.steps.reduce((total, step) => total + step.files.length, 0)
}

export function isExplainFolded(state: ReaderFoldState, sectionId: string): boolean {
  return state.explanations.has(sectionId)
}

export function isStepFolded(state: ReaderFoldState, stepId: string): boolean {
  return state.steps.has(stepId)
}

export function isFileFolded(state: ReaderFoldState, stepId: string, filePathValue: string): boolean {
  return state.files.has(fileKey(stepId, filePathValue))
}

export function toggleExplanation(state: ReaderFoldState, sectionId: string): ReaderFoldState {
  return { ...state, explanations: toggled(state.explanations, sectionId) }
}

export function toggleStep(state: ReaderFoldState, stepId: string): ReaderFoldState {
  return { ...state, steps: toggled(state.steps, stepId) }
}

export function toggleFile(state: ReaderFoldState, stepId: string, filePathValue: string): ReaderFoldState {
  return { ...state, files: toggled(state.files, fileKey(stepId, filePathValue)) }
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

export interface StepTreeRow {
  kind: 'step'
  sectionId: string
  step: ExplainStep
  folded: boolean
}

export interface FileTreeRow {
  kind: 'file'
  sectionId: string
  stepId: string
  file: HunkDiffFile
  folded: boolean
}

export type ReaderTreeRow = ExplainTreeRow | StepTreeRow | FileTreeRow

// A step only earns a row of its own when it carries text. A step that is nothing but
// changes would otherwise render as a blank line above its own diffs.
export function visibleTreeRows(sections: ExplainSection[], state: ReaderFoldState): ReaderTreeRow[] {
  const rows: ReaderTreeRow[] = []
  for (const section of sections) {
    const sectionFolded = isExplainFolded(state, section.id)
    rows.push({ kind: 'explain', section, folded: sectionFolded })
    if (sectionFolded) continue

    for (const step of section.steps) {
      const stepFolded = isStepFolded(state, step.id)
      if (step.text.trim() !== '') {
        rows.push({ kind: 'step', sectionId: section.id, step, folded: stepFolded })
        if (stepFolded) continue
      }
      for (const file of step.files) {
        rows.push({
          kind: 'file',
          sectionId: section.id,
          stepId: step.id,
          file,
          folded: isFileFolded(state, step.id, filePath(file)),
        })
      }
    }
  }
  return rows
}

export function cursorOfRow(row: ReaderTreeRow): ReaderCursor {
  if (row.kind === 'explain') return { sectionId: row.section.id, stepId: null, path: null }
  if (row.kind === 'step') return { sectionId: row.sectionId, stepId: row.step.id, path: null }
  return { sectionId: row.sectionId, stepId: row.stepId, path: filePath(row.file) }
}

export function cursorIndex(rows: ReaderTreeRow[], cursor: ReaderCursor | null): number {
  if (rows.length === 0) return -1
  if (cursor === null) return 0
  const direct = rows.findIndex((row) => {
    const at = cursorOfRow(row)
    return at.sectionId === cursor.sectionId && at.stepId === cursor.stepId && at.path === cursor.path
  })
  if (direct !== -1) return direct
  const step = rows.findIndex(
    (row) => row.kind === 'step' && cursor.stepId !== null && row.step.id === cursor.stepId,
  )
  if (step !== -1) return step
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
  if (row.kind === 'step') return toggleStep(state, row.step.id)
  return toggleFile(state, row.stepId, filePath(row.file))
}

export function rowId(row: ReaderTreeRow): string {
  if (row.kind === 'explain') return row.section.id
  if (row.kind === 'step') return row.step.id
  return fileKey(row.stepId, filePath(row.file))
}
