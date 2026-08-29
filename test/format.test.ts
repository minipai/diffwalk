import { describe, expect, test } from 'bun:test'
import { explainDocumentSchema, explainDraftSchema } from '../src/format'

function diff(patchText = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n') {
  return patchText
}

const proposalSource = { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' } as const
const workingTreeSource = {
  kind: 'working-tree',
  capturedAt: '2026-08-28T00:00:00.000Z',
  from: { revision: 'HEAD', commit: '0123456789abcdef' },
} as const
const commitDiffSource = {
  kind: 'commit-diff',
  capturedAt: '2026-08-28T00:00:00.000Z',
  from: { revision: 'main', commit: '0123456789abcdef' },
  to: { revision: 'feature', commit: 'fedcba9876543210' },
} as const

describe('explanation schema html field', () => {
  test('a version 1 document section accepts optional html', () => {
    const document = explainDocumentSchema.parse({
      formatVersion: 1,
      source: proposalSource,
      sections: [
        {
          explain: {
            title: 'Add a card',
            body: 'A body that stands alone.',
            html: '<figure><svg viewBox="0 0 10 10"></svg></figure>',
          },
          diff: diff(),
        },
      ],
    })

    expect(document.sections[0]!.explain.html).toBe(
      '<figure><svg viewBox="0 0 10 10"></svg></figure>',
    )
    expect(document.sections[0]!.explain.body).toBe('A body that stands alone.')
  })

  test('a version 1 document section parses without html', () => {
    const document = explainDocumentSchema.parse({
      formatVersion: 1,
      source: workingTreeSource,
      sections: [{ explain: { title: 'Plain', body: 'No html.' }, diff: diff() }],
    })

    expect(document.sections[0]!.explain.html).toBeUndefined()
    expect(document.formatVersion).toBe(1)
  })

  test('html is optional in draft sections', () => {
    const draft = explainDraftSchema.parse({
      draftVersion: 1,
      source: workingTreeSource,
      files: [],
      changes: [{ id: 'change-001', path: 'a.ts', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, before: 'old\n', after: 'new\n' }],
      sections: [{ explain: { title: 'Plain draft', body: 'No html.' }, changes: ['change-001'] }],
    })

    expect(draft.draftVersion).toBe(1)
    expect(draft.sections[0]!.explain.html).toBeUndefined()
  })

  test('unknown explanation fields stay rejected', () => {
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        source: proposalSource,
        sections: [
          { explain: { title: 'Bad', body: 'x', bodyHtml: '<b>x</b>' }, diff: diff() },
        ],
      }),
    ).toThrow()
  })
})

describe('document source variants', () => {
  test('accepts commit-diff, working-tree, and proposal shapes', () => {
    for (const source of [commitDiffSource, workingTreeSource, proposalSource]) {
      const document = explainDocumentSchema.parse({
        formatVersion: 1,
        source,
        sections: [{ explain: { title: 'T', body: 'b' }, diff: diff() }],
      })
      expect(document.source).toEqual(source)
    }
  })

  test('rejects the legacy git and proposed shapes', () => {
    const legacyGit = {
      kind: 'git',
      base: 'HEAD',
      baseCommit: '0123456789abcdef',
      capturedAt: '2026-08-28T00:00:00.000Z',
    }
    const legacyProposed = { kind: 'proposed' }

    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        source: legacyGit,
        sections: [{ explain: { title: 'T', body: 'b' }, diff: diff() }],
      }),
    ).toThrow()
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        source: legacyProposed,
        sections: [{ explain: { title: 'T', body: 'b' }, diff: diff() }],
      }),
    ).toThrow()
  })

  test('rejects incomplete or extra source fields', () => {
    const cases: unknown[] = [
      { ...workingTreeSource, from: undefined },
      { ...workingTreeSource, from: { revision: 'HEAD' } },
      { ...workingTreeSource, from: { revision: '', commit: 'abc' } },
      { ...commitDiffSource, to: undefined },
      { ...commitDiffSource, to: { commit: 'abc' } },
      { ...proposalSource, extra: 'x' },
      { ...workingTreeSource, capturedAt: undefined },
      { ...commitDiffSource, to: { revision: 'x', commit: '' } },
    ]

    for (const source of cases) {
      const input: unknown = {
        formatVersion: 1,
        source,
        sections: [{ explain: { title: 'T', body: 'b' }, diff: diff() }],
      }
      expect(() => explainDocumentSchema.parse(input)).toThrow()
    }
  })
})

describe('draft source', () => {
  test('requires the strict working-tree shape', () => {
    const draft = explainDraftSchema.parse({
      draftVersion: 1,
      source: workingTreeSource,
      files: [],
      changes: [],
      sections: [],
    })

    expect(draft.source).toEqual(workingTreeSource)
  })

  test('rejects non-working-tree and legacy draft sources', () => {
    const cases: unknown[] = [
      { kind: 'git', base: 'HEAD', baseCommit: 'abc', capturedAt: '2026-08-28T00:00:00.000Z' },
      commitDiffSource,
      proposalSource,
      { kind: 'working-tree', capturedAt: '2026-08-28T00:00:00.000Z', from: { revision: 'HEAD' } },
    ]

    for (const source of cases) {
      const input: unknown = { draftVersion: 1, source, files: [], changes: [], sections: [] }
      expect(() => explainDraftSchema.parse(input)).toThrow()
    }
  })
})