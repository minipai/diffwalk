import { describe, expect, test } from 'bun:test'
import { parseExplainSectionsJson, type ExplainSection } from '../src/document'
import {
  createFoldState,
  cursorIndex,
  cursorOfRow,
  fileKey,
  isExplainFolded,
  isFileFolded,
  isStepFolded,
  moveCursor,
  rowId,
  sectionFileCount,
  toggleExplanation,
  toggleFile,
  toggleRow,
  toggleStep,
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

function sectionDocument(sections: { title: string; steps: { text?: string; diff?: string }[] }[]): string {
  return JSON.stringify({
    formatVersion: 1,
    title: 'A change set',
    summary: '',
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections: sections.map(({ title, steps }) => ({
      title,
      steps: steps.map((step) => ({ text: step.text ?? '', ...(step.diff ? { diff: step.diff } : {}) })),
    })),
  })
}

// The third section deliberately has no text, so it contributes no step row: a step that
// is nothing but changes would otherwise render as a blank line above its own diffs.
function fixtureSections(): ExplainSection[] {
  return parseExplainSectionsJson(
    sectionDocument([
      {
        title: 'First touch',
        steps: [{ text: 'Changes line one.', diff: hunkDiff('src/shared.ts', 'one', 'one!') }],
      },
      {
        title: 'Second touch',
        steps: [
          {
            text: 'Changes two files.',
            diff: [hunkDiff('src/a.ts', 'a', 'b'), hunkDiff('src/b.ts', 'c', 'd')].join(''),
          },
        ],
      },
      {
        title: 'Third touch',
        steps: [{ diff: hunkDiff('src/shared.ts', 'two', 'two!') }],
      },
    ]),
  )
}

function fileRows(rows: ReaderTreeRow[]) {
  return rows.filter((row) => row.kind === 'file')
}

const firstStep = (sections: ExplainSection[], index: number) => sections[index]!.steps[0]!.id

describe('reader tree fold state', () => {
  test('all nodes start expanded in document, step, and file order', () => {
    const sections = fixtureSections()
    const rows = visibleTreeRows(sections, createFoldState())

    expect(rows.map((row) => row.kind)).toEqual([
      'explain',
      'step',
      'file',
      'explain',
      'step',
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

  test('a section counts the files across all of its steps', () => {
    const sections = fixtureSections()
    expect(sections.map(sectionFileCount)).toEqual([1, 2, 1])
  })

  test('interleaved steps produce a step row before each diff group', () => {
    const sections = parseExplainSectionsJson(
      sectionDocument([
        {
          title: 'Built in order',
          steps: [
            { text: 'Setup, with no diff of its own.' },
            { text: 'Then the change.', diff: hunkDiff('src/a.ts', 'a', 'b') },
            { text: 'Then the payoff.', diff: hunkDiff('src/b.ts', 'c', 'd') },
          ],
        },
      ]),
    )
    const rows = visibleTreeRows(sections, createFoldState())

    expect(rows.map((row) => row.kind)).toEqual(['explain', 'step', 'step', 'file', 'step', 'file'])
  })

  test('collapsing an explanation hides its steps and all descendant files', () => {
    const sections = fixtureSections()
    const state = toggleExplanation(createFoldState(), sections[1]!.id)
    const rows = visibleTreeRows(sections, state)

    expect(rows.map((row) => row.kind)).toEqual([
      'explain',
      'step',
      'file',
      'explain',
      'explain',
      'file',
    ])
    expect(rows[3]).toMatchObject({ kind: 'explain', section: sections[1], folded: true })
    expect(fileRows(rows).map((row) => row.file.path)).toEqual(['src/shared.ts', 'src/shared.ts'])
  })

  test('collapsing a step hides its files but keeps its own row', () => {
    const sections = fixtureSections()
    const state = toggleStep(createFoldState(), firstStep(sections, 1))
    const rows = visibleTreeRows(sections, state)

    expect(rows.map((row) => row.kind)).toEqual([
      'explain',
      'step',
      'file',
      'explain',
      'step',
      'explain',
      'file',
    ])
    expect(isStepFolded(state, firstStep(sections, 1))).toBe(true)
    expect(isStepFolded(state, firstStep(sections, 0))).toBe(false)
  })

  test('explanation, step, and file folds toggle independently', () => {
    const sections = fixtureSections()
    let state = createFoldState()
    state = toggleFile(state, firstStep(sections, 2), 'src/shared.ts')

    expect(isFileFolded(state, firstStep(sections, 2), 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, firstStep(sections, 0), 'src/shared.ts')).toBe(false)
    expect(sections.every((section) => !isExplainFolded(state, section.id))).toBe(true)

    state = toggleExplanation(state, sections[2]!.id)
    expect(isExplainFolded(state, sections[2]!.id)).toBe(true)
    expect(isFileFolded(state, firstStep(sections, 2), 'src/shared.ts')).toBe(true)

    const rows = visibleTreeRows(sections, state)
    expect(rows[7]).toMatchObject({ kind: 'explain', section: sections[2], folded: true })
    expect(fileRows(rows).map((row) => row.file.path)).toEqual([
      'src/shared.ts',
      'src/a.ts',
      'src/b.ts',
    ])
  })

  test('reopening an explanation preserves its descendant file folds', () => {
    const sections = fixtureSections()
    let state = createFoldState()
    state = toggleFile(state, firstStep(sections, 0), 'src/shared.ts')
    state = toggleExplanation(state, sections[0]!.id)
    state = toggleExplanation(state, sections[0]!.id)

    expect(isExplainFolded(state, sections[0]!.id)).toBe(false)
    expect(isFileFolded(state, firstStep(sections, 0), 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, firstStep(sections, 2), 'src/shared.ts')).toBe(false)

    const rows = visibleTreeRows(sections, state)
    expect(rows[2]).toMatchObject({ kind: 'file', folded: true })
  })

  test('the same path across steps folds independently', () => {
    const sections = fixtureSections()
    expect(fileKey(firstStep(sections, 0), 'src/shared.ts')).not.toBe(
      fileKey(firstStep(sections, 2), 'src/shared.ts'),
    )

    let state = toggleFile(createFoldState(), firstStep(sections, 0), 'src/shared.ts')
    expect(isFileFolded(state, firstStep(sections, 0), 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, firstStep(sections, 2), 'src/shared.ts')).toBe(false)

    state = toggleFile(state, firstStep(sections, 2), 'src/shared.ts')
    expect(isFileFolded(state, firstStep(sections, 0), 'src/shared.ts')).toBe(true)
    expect(isFileFolded(state, firstStep(sections, 2), 'src/shared.ts')).toBe(true)
  })
})

describe('reader cursor navigation', () => {
  const sections = () => fixtureSections()
  const rowsOf = (foldState = createFoldState()) => visibleTreeRows(sections(), foldState)

  test('a null cursor starts on the first visible row', () => {
    expect(cursorIndex(rowsOf(), null)).toBe(0)
  })

  test('cursorOfRow points at the explanation, its step, and the file under it', () => {
    const rows = rowsOf()
    expect(cursorOfRow(rows[0]!)).toEqual({
      sectionId: 'explanation:0',
      stepId: null,
      path: null,
    })
    expect(cursorOfRow(rows[1]!)).toEqual({
      sectionId: 'explanation:0',
      stepId: 'explanation:0/step:0',
      path: null,
    })
    expect(cursorOfRow(rows[2]!)).toEqual({
      sectionId: 'explanation:0',
      stepId: 'explanation:0/step:0',
      path: 'src/shared.ts',
    })
  })

  test('moveCursor steps across visible rows and clamps at the edges', () => {
    const rows = rowsOf()
    let cursor = null

    cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(1)

    cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(2)

    for (let i = 0; i < 20; i++) cursor = moveCursor(rows, cursor, -1)
    expect(cursorIndex(rows, cursor)).toBe(0)

    for (let i = 0; i < 20; i++) cursor = moveCursor(rows, cursor, 1)
    expect(cursorIndex(rows, cursor)).toBe(rows.length - 1)
  })

  test('folding an explanation with the cursor on a hidden file moves it to that explanation', () => {
    const rows = rowsOf()
    const fileRow = rows[2]!
    expect(fileRow.kind).toBe('file')
    const fileCursor = cursorOfRow(fileRow)

    const state = toggleRow(createFoldState(), rows[0]!)
    expect(isExplainFolded(state, 'explanation:0')).toBe(true)

    const nextRows = visibleTreeRows(sections(), state)
    expect(nextRows.map((row) => row.kind)).toEqual([
      'explain',
      'explain',
      'step',
      'file',
      'file',
      'explain',
      'file',
    ])
    expect(cursorIndex(nextRows, fileCursor)).toBe(0)
    expect(cursorOfRow(nextRows[cursorIndex(nextRows, fileCursor)]!)).toEqual({
      sectionId: 'explanation:0',
      stepId: null,
      path: null,
    })
  })

  test('folding a step with the cursor on a hidden file moves it to that step', () => {
    const rows = rowsOf()
    const fileCursor = cursorOfRow(rows[2]!)
    const state = toggleRow(createFoldState(), rows[1]!)

    const nextRows = visibleTreeRows(sections(), state)
    expect(nextRows.map((row) => row.kind)).toEqual([
      'explain',
      'step',
      'explain',
      'step',
      'file',
      'file',
      'explain',
      'file',
    ])
    expect(cursorIndex(nextRows, fileCursor)).toBe(1)
  })

  test('a cursor on a still-visible explanation survives folding it', () => {
    const rows = rowsOf()
    const explainCursor = cursorOfRow(rows[0]!)
    const state = toggleRow(createFoldState(), rows[0]!)
    expect(cursorIndex(visibleTreeRows(sections(), state), explainCursor)).toBe(0)
  })

  test('folding a file keeps its row visible and keeps the cursor on it', () => {
    const rows = rowsOf()
    const fileCursor = cursorOfRow(rows[2]!)
    const state = toggleRow(createFoldState(), rows[2]!)
    const nextRows = visibleTreeRows(sections(), state)
    expect(nextRows[2]).toMatchObject({ kind: 'file', folded: true })
    expect(cursorIndex(nextRows, fileCursor)).toBe(2)
  })

  test('cursorIndex falls back to the first row when the section vanishes', () => {
    const rows = rowsOf()
    const thirdCursor = cursorOfRow(rows[rows.length - 1]!)
    expect(cursorIndex(rows.slice(0, -2), thirdCursor)).toBe(0)
  })

  test('an empty tree has no cursor and moving does not crash', () => {
    expect(cursorIndex([], null)).toBe(-1)
    expect(moveCursor([], null, 1)).toBeNull()
  })

  test('rowId is unique per explanation, step, and file', () => {
    const rows = rowsOf()
    expect(rowId(rows[0]!)).toBe('explanation:0')
    expect(rowId(rows[1]!)).toBe('explanation:0/step:0')
    expect(rowId(rows[2]!)).toBe('explanation:0/step:0/src/shared.ts')
    expect(new Set(rows.map(rowId)).size).toBe(rows.length)
  })

  test('toggleRow folds the row the cursor is on and leaves siblings unchanged', () => {
    const rows = rowsOf()
    let state = toggleRow(createFoldState(), rows[2]!)
    expect(isFileFolded(state, 'explanation:0/step:0', 'src/shared.ts')).toBe(true)
    expect(isExplainFolded(state, 'explanation:0')).toBe(false)

    state = toggleRow(state, rows[0]!)
    expect(isExplainFolded(state, 'explanation:0')).toBe(true)
    expect(isFileFolded(state, 'explanation:0/step:0', 'src/shared.ts')).toBe(true)
    expect(isExplainFolded(state, 'explanation:1')).toBe(false)
  })
})
