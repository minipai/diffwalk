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
      oldMode: '100644',
      newMode: '100644',
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

describe('document schema steps', () => {
  test('a version 1 document section accepts interleaved steps', () => {
    const input = {
      formatVersion: 1,
      title: 'Add a card',
      summary: 'Why the card exists.',
      source: proposalSource,
      sections: [
        {
          title: 'Add a card',
          steps: [
            { text: 'Text that stands alone.' },
            {
              text: 'And the change it describes.',
              diff: diff(),
              changes: ['change-001'],
            },
          ],
        },
      ],
    } as const
    const document = explainDocumentSchema.parse(input)
    const roundTripped = explainDocumentSchema.parse(JSON.parse(JSON.stringify(document)))

    expect(document.title).toBe('Add a card')
    expect(document.summary).toBe('Why the card exists.')
    expect(document.sections[0]!.steps[0]!.diff).toBeUndefined()
    expect(document.sections[0]!.steps[1]!.diff).toContain('diff --git')
    expect(document.sections[0]!.steps[1]!.changes).toEqual(['change-001'])
    expect(roundTripped).toEqual(document)
  })

  test('a summary defaults to empty and a title is required', () => {
    const document = explainDocumentSchema.parse({
      formatVersion: 1,
      title: 'Plain',
      source: workingTreeSource,
      sections: [{ title: 'Plain', steps: [{ text: 'No summary.', diff: diff() }] }],
    })

    expect(document.summary).toBe('')
    expect(document.formatVersion).toBe(1)
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        source: workingTreeSource,
        sections: [{ title: 'Plain', steps: [{ text: 'x', diff: diff() }] }],
      }),
    ).toThrow()
  })

  test('unknown step fields and empty steps stay rejected', () => {
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'Bad',
        source: proposalSource,
        sections: [{ title: 'Bad', steps: [{ text: 'x', html: '<b>x</b>' }] }],
      }),
    ).toThrow()
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'Bad',
        source: proposalSource,
        sections: [{ title: 'Bad', steps: [{ text: '  ' }] }],
      }),
    ).toThrow()
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'Bad',
        source: proposalSource,
        sections: [{ title: 'Bad', steps: [{ text: 'x', changes: [] }] }],
      }),
    ).toThrow()
  })

  test('strictly validates captured change IDs when the field is present', () => {
    for (const changes of [[], [''], [1], null, 'change-001']) {
      expect(() =>
        explainDocumentSchema.parse({
          formatVersion: 1,
          title: 'Bad changes',
          source: proposalSource,
          sections: [{ title: 'Bad changes', steps: [{ text: 'x', diff: diff(), changes }] }],
        }),
      ).toThrow()
    }
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'Missing diff',
        source: proposalSource,
        sections: [
          { title: 'Missing diff', steps: [{ text: 'Only text.', changes: ['change-001'] }] },
        ],
      }),
    ).toThrow('captured change IDs require a diff')
  })

  test('keeps legacy version 1 steps without captured change IDs compatible', () => {
    const document = explainDocumentSchema.parse({
      formatVersion: 1,
      title: 'Published before targets',
      source: proposalSource,
      sections: [{ title: 'Legacy', steps: [{ text: 'Still readable.', diff: diff() }] }],
    })

    expect(document.sections[0]!.steps[0]!.changes).toBeUndefined()
  })
})

describe('document source variants', () => {
  test('accepts commit-diff, working-tree, and proposal shapes', () => {
    for (const source of [commitDiffSource, workingTreeSource, proposalSource]) {
      const document = explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'T',
        source,
        sections: [{ title: 'T', steps: [{ text: 'b', diff: diff() }] }],
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
        title: 'T',
        source: legacyGit,
        sections: [{ title: 'T', steps: [{ text: 'b', diff: diff() }] }],
      }),
    ).toThrow()
    expect(() =>
      explainDocumentSchema.parse({
        formatVersion: 1,
        title: 'T',
        source: legacyProposed,
        sections: [{ title: 'T', steps: [{ text: 'b', diff: diff() }] }],
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
        title: 'T',
        source,
        sections: [{ title: 'T', steps: [{ text: 'b', diff: diff() }] }],
      }
      expect(() => explainDocumentSchema.parse(input)).toThrow()
    }
  })
})

describe('document metadata', () => {
  function attributed(metadata: unknown): unknown {
    return {
      formatVersion: 1,
      title: 'Attribution',
      source: proposalSource,
      metadata,
      sections: [{ title: 'Attribution', steps: [{ text: 'Text.', diff: diff() }] }],
    }
  }

  test('accepts full, partial, and absent attribution metadata', () => {
    const full = explainDocumentSchema.parse(
      attributed({
        explainedBy: 'Claude Code',
        publishedBy: 'Art',
        publishedAt: '2026-09-02T06:10:00.000Z',
      }),
    )
    expect(full.metadata).toEqual({
      explainedBy: 'Claude Code',
      publishedBy: 'Art',
      publishedAt: '2026-09-02T06:10:00.000Z',
    })

    for (const metadata of [
      { explainedBy: 'Claude Code' },
      { publishedBy: 'Art' },
      { publishedAt: '2026-09-02T06:10:00.000Z' },
      {},
    ]) {
      expect(explainDocumentSchema.parse(attributed(metadata)).metadata).toEqual(metadata)
    }

    expect(explainDocumentSchema.parse(attributed(undefined)).metadata).toBeUndefined()
    expect(explainDocumentSchema.parse(attributed({})).metadata).toEqual({})
  })

  test('rejects unknown metadata keys and malformed values', () => {
    for (const metadata of [
      { explainedBy: 'Claude Code', extra: 'nope' },
      { explainedBy: '' },
      { publishedBy: 7 },
      { publishedAt: 'yesterday' },
      { publishedAt: '2026-09-02' },
      'not an object',
    ]) {
      expect(() => explainDocumentSchema.parse(attributed(metadata))).toThrow()
    }
  })

  test('round-trips attribution metadata through JSON', () => {
    const document = explainDocumentSchema.parse(
      attributed({ explainedBy: 'Claude Code', publishedBy: 'Art' }),
    )
    expect(explainDocumentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document)
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

  test('defaults status-aware modes when reading captures written before mode metadata', () => {
    for (const [status, oldMode, newMode] of [
      ['added', '000000', '100644'],
      ['modified', '100644', '100644'],
      ['deleted', '100644', '000000'],
    ] as const) {
      const legacy = structuredClone(capture) as Record<string, any>
      legacy.files[0].status = status
      delete legacy.files[0].oldMode
      delete legacy.files[0].newMode

      expect(captureSchema.parse(legacy).files[0]).toEqual(
        expect.objectContaining({ oldMode, newMode }),
      )
    }
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

  test('accepts committed capture sources', () => {
    const parsed = captureSchema.parse({
      ...capture,
      source: commitDiffSource,
    })
    expect(parsed.source).toEqual(commitDiffSource)
  })
})

describe('explanations schema', () => {
  test('accepts ordered sections of steps', () => {
    const parsed = explanationsSchema.parse({
      captureId: 'b'.repeat(64),
      title: 'A change set',
      sections: [
        {
          title: 'Keep the greeting concise',
          steps: [
            { text: 'The extra phrase is no longer needed.', changes: ['change-001'] },
          ],
        },
        {
          title: 'With a diagram',
          steps: [
            { text: '<figure><svg viewBox="0 0 1 1"></svg></figure>' },
            { changes: ['change-001', 'change-002'] },
          ],
        },
      ],
    })

    expect(parsed.sections).toHaveLength(2)
    expect(parsed.summary).toBe('')
    expect(parsed.sections[0]!.steps[0]!.text).toBe('The extra phrase is no longer needed.')
    expect(parsed.sections[1]!.steps[0]!.changes).toBeUndefined()
    expect(parsed.sections[1]!.steps[1]!.text).toBe('')
  })

  test('text defaults to empty and changes are optional', () => {
    const parsed = explanationsSchema.parse({
      captureId: 'c'.repeat(64),
      title: 'Terse',
      sections: [{ title: 'Terse', steps: [{ changes: ['change-001'] }] }],
    })

    expect(parsed.sections[0]!.steps[0]!.text).toBe('')
  })

  test('a step needs text, changes, or both', () => {
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        title: 'x',
        sections: [{ title: 'x', steps: [{ text: '' }] }],
      }),
    ).toThrow()
  })

  test('rejects a missing captureId or title, allows empty sections', () => {
    expect(() =>
      explanationsSchema.parse({
        title: 'x',
        sections: [{ title: 'x', steps: [{ changes: ['change-001'] }] }],
      }),
    ).toThrow()
    expect(() =>
      explanationsSchema.parse({ captureId: 'x', sections: [] }),
    ).toThrow()
    expect(
      explanationsSchema.parse({ captureId: 'x', title: 'x', sections: [] }).sections,
    ).toEqual([])
  })

  test('rejects unknown section fields, unknown step fields, and empty titles', () => {
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        title: 'x',
        sections: [{ title: 'x', body: 'gone', steps: [{ changes: ['c'] }] }],
      }),
    ).toThrow()
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        title: 'x',
        sections: [{ title: 'x', steps: [{ html: 'gone', changes: ['c'] }] }],
      }),
    ).toThrow()
    expect(() =>
      explanationsSchema.parse({
        captureId: 'x',
        title: 'x',
        sections: [{ title: '', steps: [{ changes: ['c'] }] }],
      }),
    ).toThrow()
  })

  test('accepts an optional explainedBy author and nothing else', () => {
    const withAuthor = explanationsSchema.parse({
      captureId: 'x',
      title: 'x',
      metadata: { explainedBy: 'Claude Code' },
      sections: [],
    })
    expect(withAuthor.metadata).toEqual({ explainedBy: 'Claude Code' })
    expect(
      explanationsSchema.parse({ captureId: 'x', title: 'x', sections: [] }).metadata,
    ).toBeUndefined()

    // publishedBy and publishedAt are supplied by other layers, so the authoring file
    // rejects them instead of silently dropping authored data.
    for (const metadata of [
      { publishedBy: 'Art' },
      { publishedAt: '2026-09-02T06:10:00.000Z' },
      { explainedBy: 'Claude Code', extra: 'nope' },
      { explainedBy: '' },
    ]) {
      expect(() =>
        explanationsSchema.parse({ captureId: 'x', title: 'x', metadata, sections: [] }),
      ).toThrow()
    }
  })
})
