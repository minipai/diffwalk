import { describe, expect, test } from 'bun:test'
import { parseExplainSectionsJson, type ExplainSection } from '../src/document'
import {
  createFoldState,
  cursorIndex,
  cursorOfRow,
  fileKey,
  isExplainFolded,
  isFileFolded,
  moveCursor,
  rowId,
  toggleExplanation,
  toggleFile,
  toggleRow,
  visibleTreeRows,
  type ReaderTreeRow,
} from '../src/reader'

function hunkDiff(path: string, oldLine: string, newLine: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    `-${oldLine}`,
    `+${newLine}`,
    '',
  ].join('\n')
}

function sectionDocument(...diffs: { title: string; body: string; diff: string }[]): string {
  return JSON.stringify({
    formatVersion: 1,
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections: diffs.map(({ title, body, diff }) => ({ explain: { title, body }, diff })),
  })
}

function fixtureSections(): ExplainSection[] {
  return parseExplainSectionsJson(
    sectionDocument(
      { title: 'First touch', body: 'Changes line one.', diff: hunkDiff('src/shared.ts', 'one', 'one!') },
      {
        title: 'Second touch',
        body: 'Changes two files.',
        diff: [hunkDiff('src/a.ts', 'a', 'b'), hunkDiff('src/b.ts', 'c', 'd')].join(''),
      },
      { title: 'Third touch', body: 'Changes shared again.', diff: hunkDiff('src/shared.ts', 'two', 'two!') },
    ),
  )
}

function fileRows(rows: ReaderTreeRow[]) {
  return rows.filter((row) => row.kind === 'file')
}

describe('reader tree fold state', () => {
  test('all nodes start expanded in document and file order', () => {
    const sections = fixtureSections()
    const rows = visibleTreeRows(sections, createFoldState())

    expect(rows.map((row) => row.kind)).toEqual([
      'explain',
      'file',
      'explain',
      'file',
      'file',
      'explain',
      'file',
    ])
    expect(
      rows
        .filter((row): row is Extract<ReaderTreeRow, { kind: 'explain' }> => row.kind === 'explain')
        .map((row) => row.section.title),
    ).toEqual(['First touch', 'Second touch', 'Third touch'])
    expect(fileRows(rows).map((row) => row.file.path)).toEqual([
      'src/shared.ts',
      'src/a.ts',
      'src/b.ts',
      'src/shared.ts',
    ])
    expect(rows.every((row) => row.folded === false)).toBe(true)
  })

  test('collapsing an explanation hides its body and all descendant files', () => {
    const sections = fixtureSections()
    let state = toggleExplanation(createFoldState(), sections[1]!.id)
    const rows = visibleTreeRows(sections, state)

    expect(rows.map((row) => row.kind)).toEqual(['explain', 'file', 'explain', 'explain', 'file'])
    expect(rows[2]).toMatchObject({ kind: 'explain', section: sections[1], folded: true })
    expect(fileRows(rows).map((row) => row.file.path)).toEqual(['src/shared.ts', 'src/shared.ts'])
  })

  test('explanation and file folds toggle independently', () => {
    const sections = fixtureSections()
    let state = createFoldState()
    state = toggleFile(state, sections[2]!.id, 'src/shared.ts')

    expect(isFileFolded(state, sections[2]!.id, 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, sections[0]!.id, 'src/shared.ts')).toBe(false)
    expect(sections.every((section) => !isExplainFolded(state, section.id))).toBe(true)

    state = toggleExplanation(state, sections[2]!.id)
    expect(isExplainFolded(state, sections[2]!.id)).toBe(true)
    expect(isFileFolded(state, sections[2]!.id, 'src/shared.ts')).toBe(true)

    const rows = visibleTreeRows(sections, state)
    expect(rows[5]).toMatchObject({ kind: 'explain', section: sections[2], folded: true })
    expect(fileRows(rows).map((row) => row.file.path)).toEqual([
      'src/shared.ts',
      'src/a.ts',
      'src/b.ts',
    ])
  })

  test('reopening an explanation preserves its descendant file folds', () => {
    const sections = fixtureSections()
    let state = createFoldState()
    state = toggleFile(state, sections[0]!.id, 'src/shared.ts')
    state = toggleExplanation(state, sections[0]!.id)
    state = toggleExplanation(state, sections[0]!.id)

    expect(isExplainFolded(state, sections[0]!.id)).toBe(false)
    expect(isFileFolded(state, sections[0]!.id, 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, sections[2]!.id, 'src/shared.ts')).toBe(false)

    const rows = visibleTreeRows(sections, state)
    expect(rows[1]).toMatchObject({ kind: 'file', folded: true })
  })

  test('the same path across sections folds independently', () => {
    const sections = fixtureSections()
    expect(fileKey(sections[0]!.id, 'src/shared.ts')).not.toBe(
      fileKey(sections[2]!.id, 'src/shared.ts'),
    )

    let state = toggleFile(createFoldState(), sections[0]!.id, 'src/shared.ts')
    expect(isFileFolded(state, sections[0]!.id, 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, sections[2]!.id, 'src/shared.ts')).toBe(false)

    state = toggleFile(state, sections[2]!.id, 'src/shared.ts')
    expect(isFileFolded(state, sections[0]!.id, 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, sections[2]!.id, 'src/shared.ts')).toBe(true)
  })
})

describe('reader cursor navigation', () => {
  const sections = () => fixtureSections()
  const rowsOf = (foldState = createFoldState()) => visibleTreeRows(sections(), foldState)

  test('a null cursor starts on the first visible row', () => {
    const rows = rowsOf()
    expect(cursorIndex(rows, null)).toBe(0)
  })

  test('cursorOfRow points at the explanation node and the file node under it', () => {
    const rows = rowsOf()
    expect(cursorOfRow(rows[0]!)).toEqual({ sectionId: 'explanation:0', path: null })
    expect(cursorOfRow(rows[1]!)).toEqual({
      sectionId: 'explanation:0',
      path: 'src/shared.ts',
    })
  })

  test('moveCursor steps across visible explanation and file rows and clamps at the edges', () => {
    const rows = rowsOf()
    let cursor = null

    cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(1)

    cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(2)

    cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(3)

    for (let i = 0; i < 10; i++) cursor = moveCursor(rows, cursor, -1)
    expect(cursorIndex(rows, cursor)).toBe(0)

    for (let i = 0; i < 10; i++) cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(rows.length - 1)
  })

  test('arrow and j/k keys share the same visible-row navigation', () => {
    const rows = rowsOf()
    const fromArrows = moveCursor(rows, moveCursor(rows, null, 1), 1)
    const fromLetters = moveCursor(rows, moveCursor(rows, null, 1), 1)
    expect(fromArrows).toEqual(fromLetters)
    expect(cursorIndex(rows, fromLetters)).toBe(2)
  })

  test('folding an explanation with the cursor on a hidden file moves it to that explanation', () => {
    const rows = rowsOf()
    const fileRow = rows[1]!
    expect(fileRow.kind).toBe('file')
    const fileCursor = cursorOfRow(fileRow)

    let state = toggleRow(createFoldState(), rows[0]!)
    expect(isExplainFolded(state, 'explanation:0')).toBe(true)

    const nextRows = visibleTreeRows(sections(), state)
    expect(nextRows.map((row) => row.kind)).toEqual([
      'explain',
      'explain',
      'file',
      'file',
      'explain',
      'file',
    ])
    expect(cursorIndex(nextRows, fileCursor)).toBe(0)
    expect(cursorOfRow(nextRows[cursorIndex(nextRows, fileCursor)]!)).toEqual({
      sectionId: 'explanation:0',
      path: null,
    })
  })

  test('a cursor on a still-visible explanation survives folding it', () => {
    const rows = rowsOf()
    const explainCursor = cursorOfRow(rows[0]!)
    let state = toggleRow(createFoldState(), rows[0]!)
    const nextRows = visibleTreeRows(sections(), state)
    expect(cursorIndex(nextRows, explainCursor)).toBe(0)
  })

  test('folding a file keeps its row visible and keeps the cursor on it', () => {
    const rows = rowsOf()
    const fileCursor = cursorOfRow(rows[1]!)
    let state = toggleRow(createFoldState(), rows[1]!)
    const nextRows = visibleTreeRows(sections(), state)
    expect(nextRows[1]).toMatchObject({ kind: 'file', folded: true })
    expect(cursorIndex(nextRows, fileCursor)).toBe(1)
  })

  test('cursorIndex falls back to the first row when the section vanishes', () => {
    const rows = rowsOf()
    const rowsWithoutThirdSection = rows.slice(0, -2)
    const thirdCursor = cursorOfRow(rows[rows.length - 1]!)
    expect(cursorIndex(rowsWithoutThirdSection, thirdCursor)).toBe(0)
  })

  test('an empty tree has no cursor and moving does not crash', () => {
    expect(cursorIndex([], null)).toBe(-1)
    expect(moveCursor([], null, 1)).toBeNull()
  })

  test('rowId is unique per explanation and per file within an explanation', () => {
    const rows = rowsOf()
    expect(rowId(rows[0]!)).toBe('explanation:0')
    expect(rowId(rows[1]!)).toBe('explanation:0/src/shared.ts')
    expect(new Set(rows.map(rowId)).size).toBe(rows.length)
  })

  test('toggleRow folds the row the cursor is on and leaves siblings unchanged', () => {
    const rows = rowsOf()
    let state = toggleRow(createFoldState(), rows[1]!)
    expect(isFileFolded(state, 'explanation:0', 'src/shared.ts')).toBe(true)
    expect(isExplainFolded(state, 'explanation:0')).toBe(false)

    state = toggleRow(state, rows[0]!)
    expect(isExplainFolded(state, 'explanation:0')).toBe(true)
    expect(isFileFolded(state, 'explanation:0', 'src/shared.ts')).toBe(true)
    expect(isExplainFolded(state, 'explanation:1')).toBe(false)
  })
})
