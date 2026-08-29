import { describe, expect, test } from 'bun:test'
import { createHunkDiffFilesFromPatch } from 'hunkdiff/opentui'
import { buildExplainDocument, createExplainDraft } from '../src/authoring'
import type { ExplainDraft } from '../src/format'

const source: ExplainDraft['source'] = {
  kind: 'working-tree',
  from: { revision: 'HEAD', commit: '0123456789abcdef' },
  capturedAt: '2026-08-28T00:00:00.000Z',
}

function draftWithTwoChanges() {
  return createExplainDraft(
    [
      {
        path: 'example.ts',
        status: 'modified',
        oldContent: 'a\nb\nc\nd\ne\nf\n',
        newContent: 'a\nB\nc\nd\nE\nf\n',
      },
    ],
    source,
  )
}

describe('explain authoring', () => {
  test('exposes separate change blocks even when Pierre renders one nearby hunk', () => {
    const draft = draftWithTwoChanges()

    expect(draft.changes).toEqual([
      expect.objectContaining({ id: 'change-001', before: 'b\n', after: 'B\n' }),
      expect.objectContaining({ id: 'change-002', before: 'e\n', after: 'E\n' }),
    ])
  })

  test('materializes each explanation as an independently parseable Git patch', () => {
    const draft = draftWithTwoChanges()
    draft.sections = [
      {
        explain: { title: 'Later change first', body: 'Explain E before B.' },
        changes: ['change-002'],
      },
      {
        explain: { title: 'Earlier change second', body: 'Then explain B.' },
        changes: ['change-001'],
      },
    ]

    const document = buildExplainDocument(draft)

    expect(document.sections.map((section) => section.explain.title)).toEqual([
      'Later change first',
      'Earlier change second',
    ])
    expect(document.sections[0]!.diff).toContain('+E')
    expect(document.sections[0]!.diff).not.toContain('+B')
    expect(document.sections[1]!.diff).toContain('+B')
    expect(document.sections[1]!.diff).not.toContain('+E')
    for (const section of document.sections) {
      expect(createHunkDiffFilesFromPatch(section.diff)).toHaveLength(1)
    }
  })

  test('requires every change ID exactly once', () => {
    const unassigned = draftWithTwoChanges()
    unassigned.sections = [
      { explain: { title: 'One', body: '' }, changes: ['change-001'] },
    ]
    expect(() => buildExplainDocument(unassigned)).toThrow('Unassigned change IDs: change-002')

    const duplicate = draftWithTwoChanges()
    duplicate.sections = [
      { explain: { title: 'One', body: '' }, changes: ['change-001'] },
      { explain: { title: 'Again', body: '' }, changes: ['change-001', 'change-002'] },
    ]
    expect(() => buildExplainDocument(duplicate)).toThrow('assigned more than once')

    const unknown = draftWithTwoChanges()
    unknown.sections = [
      { explain: { title: 'Unknown', body: '' }, changes: ['change-999'] },
    ]
    expect(() => buildExplainDocument(unknown)).toThrow('Unknown change ID: change-999')
  })

  test('emits parseable patches for added, deleted, and pure renamed files', () => {
    const draft = createExplainDraft(
      [
        { path: 'added.ts', status: 'added', oldContent: '', newContent: 'added\n' },
        { path: 'deleted.ts', status: 'deleted', oldContent: 'deleted\n', newContent: '' },
        {
          path: 'new-name.ts',
          oldPath: 'old-name.ts',
          status: 'renamed',
          oldContent: 'same\n',
          newContent: 'same\n',
        },
      ],
      source,
    )
    draft.sections = draft.changes.map((change, index) => ({
      explain: { title: `Change ${index + 1}`, body: '' },
      changes: [change.id],
    }))

    const document = buildExplainDocument(draft)

    expect(document.sections[0]!.diff).toContain('new file mode')
    expect(document.sections[1]!.diff).toContain('deleted file mode')
    expect(document.sections[2]!.diff).toContain('rename from old-name.ts')
    for (const section of document.sections) {
      expect(createHunkDiffFilesFromPatch(section.diff)).toHaveLength(1)
    }
  })

  test('carries optional html through build without touching capture or assignment invariants', () => {
    const draft = draftWithTwoChanges()
    const fragment = '<figure><svg viewBox="0 0 640 180" role="img"><rect width="10" height="10"/></svg></figure>'
    draft.sections = [
      {
        explain: {
          title: 'Later change first',
          body: 'Explain E before B.',
          html: fragment,
        },
        changes: ['change-002'],
      },
      {
        explain: { title: 'Earlier change second', body: 'Then explain B.' },
        changes: ['change-001'],
      },
    ]

    const document = buildExplainDocument(draft)

    expect(document.formatVersion).toBe(1)
    expect(draft.draftVersion).toBe(1)
    expect(document.sections[0]!.explain.html).toBe(fragment)
    expect(document.sections[0]!.explain.body).toBe('Explain E before B.')
    expect(document.sections[1]!.explain.html).toBeUndefined()
    expect(document.sections.map((section) => section.explain.title)).toEqual([
      'Later change first',
      'Earlier change second',
    ])
    expect(document.sections[0]!.diff).toContain('+E')
    expect(document.sections[1]!.diff).toContain('+B')
    for (const section of document.sections) {
      expect(createHunkDiffFilesFromPatch(section.diff)).toHaveLength(1)
    }
  })
})
