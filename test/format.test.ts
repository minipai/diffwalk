import { describe, expect, test } from 'bun:test'
import { captureSchema, explainDocumentSchema, explanationsSchema } from '../src/format'

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

const capture = {
  captureId: 'a'.repeat(64),
  source: workingTreeSource,
  files: [
    {
      path: 'example.ts',
      status: 'modified',
      oldContent: 'old\n',
      newContent: 'new\n',
    },
  ],
  changes: [
    {
      id: 'change-001',
      path: 'example.ts',
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      before: 'old\n',
      after: 'new\n',
    },
  ],
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

describe('capture schema', () => {
  test('accepts the machine-owned capture shape with no sections', () => {
    const parsed = captureSchema.parse(capture)

    expect(parsed.captureId).toBe('a'.repeat(64))
    expect(parsed.source).toEqual(workingTreeSource)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.changes).toHaveLength(1)
    expect('sections' in parsed).toBe(false)
  })

  test('rejects captures with authored sections or extra fields', () => {
    expect(() =>
      captureSchema.parse({ ...capture, sections: [{ title: 'x', changes: ['change-001'] }] }),
    ).toThrow()
    expect(() => captureSchema.parse({ ...capture, extra: 'x' })).toThrow()
  })

  test('requires a captureId and strict working-tree source', () => {
    expect(() => captureSchema.parse({ ...capture, captureId: '' })).toThrow()
    expect(() =>
      captureSchema.parse({
        ...capture,
        source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
      }),
    ).toThrow()
    expect(() =>
      captureSchema.parse({
        ...capture,
        source: {
          kind: 'working-tree',
          capturedAt: '2026-08-28T00:00:00.000Z',
          from: { revision: 'HEAD' },
        },
      }),
    ).toThrow()
  })

  test('requires files and changes to be present arrays', () => {
    expect(() => captureSchema.parse({ ...capture, files: undefined })).toThrow()
    expect(() => captureSchema.parse({ ...capture, changes: undefined })).toThrow()
  })
})

describe('explanations schema', () => {
  test('accepts ordered sections with change IDs', () => {
    const parsed = explanationsSchema.parse({
      captureId: 'b'.repeat(64),
      sections: [
        {
          title: 'Keep the greeting concise',
          body: 'The extra phrase is no longer needed.',
          changes: ['change-001'],
        },
        {
          title: 'With a fragment',
          html: '<figure><svg viewBox="0 0 1 1"></svg></figure>',
          changes: ['change-001', 'change-002'],
        },
      ],
    })

    expect(parsed.sections).toHaveLength(2)
    expect(parsed.sections[0]!.body).toBe('The extra phrase is no longer needed.')
    expect(parsed.sections[0]!.html).toBeUndefined()
    expect(parsed.sections[1]!.html).toContain('<figure>')
  })

  test('body defaults to empty and html is optional', () => {
    const parsed = explanationsSchema.parse({
      captureId: 'c'.repeat(64),
      sections: [{ title: 'Terse', changes: ['change-001'] }],
    })

    expect(parsed.sections[0]!.body).toBe('')
  })

  test('rejects missing captureId or sections without changes, allows empty sections', () => {
    expect(() =>
      explanationsSchema.parse({ sections: [{ title: 'x', changes: ['change-001'] }] }),
    ).toThrow()
    expect(explanationsSchema.parse({ captureId: 'x', sections: [] }).sections).toEqual([])
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        sections: [{ title: 'x', body: 'no ids' }],
      }),
    ).toThrow()
  })

  test('rejects unknown section fields and empty titles', () => {
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        sections: [{ title: 'x', changes: ['c'], explain: {} }],
      }),
    ).toThrow()
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        sections: [{ title: '', changes: ['c'] }],
      }),
    ).toThrow()
  })
})
