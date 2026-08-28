import { describe, expect, test } from 'bun:test'
import { parseExplainSectionsJson, type ExplainSection } from '../src/document'
import {
  createFoldState,
  fileKey,
  isExplainFolded,
  isFileFolded,
  toggleExplanation,
  toggleFile,
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
    source: { kind: 'proposed' },
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
