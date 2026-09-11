import { describe, expect, test } from 'bun:test'
import {
  captureIdFor,
  createExplainCapture,
  duplicatedChangeIds,
  materializeExplainDocument,
} from '../src/authoring/capture'
import type { CaptureSource, ExplainCapture } from '../src/format'
import { fileDiffStats, parseSectionPatch } from '../src/report/patches'

const source: CaptureSource = {
  kind: 'working-tree',
  from: { revision: 'HEAD', commit: '0123456789abcdef' },
  capturedAt: '2026-08-28T00:00:00.000Z',
}

const regularModes = { oldMode: '100644', newMode: '100644' } as const

function captureWithTwoChanges(): ExplainCapture {
  return createExplainCapture(
    [
      {
        path: 'example.ts',
        status: 'modified',
        ...regularModes,
        oldContent: 'a\nb\nc\nd\ne\nf\n',
        newContent: 'a\nB\nc\nd\nE\nf\n',
      },
    ],
    source,
  )
}

function allChangesAssigned(capture: ExplainCapture) {
  return {
    captureId: capture.captureId,
    title: 'A change set',
    summary: '',
    sections: capture.changes.map((change, index) => ({
      title: `Section ${index + 1}`,
      steps: [{ text: '', changes: [change.id] }],
    })),
  }
}

describe('explain capture', () => {
  test('exposes separate change blocks even when Pierre renders one nearby hunk', () => {
    const capture = captureWithTwoChanges()

    expect(capture.changes).toEqual([
      expect.objectContaining({ id: 'change-001', before: 'b\n', after: 'B\n' }),
      expect.objectContaining({ id: 'change-002', before: 'e\n', after: 'E\n' }),
    ])
    expect(capture).not.toHaveProperty('sections')
  })

  test('captureId identifies captured contents, not the capture timestamp', () => {
    const morning = createExplainCapture(
      [
        {
          path: 'a.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'old\n',
          newContent: 'new\n',
        },
      ],
      { ...source, capturedAt: '2026-08-28T08:00:00.000Z' },
    )
    const evening = createExplainCapture(
      [
        {
          path: 'a.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'old\n',
          newContent: 'new\n',
        },
      ],
      { ...source, capturedAt: '2026-08-28T20:00:00.000Z' },
    )
    const changed = createExplainCapture(
      [
        {
          path: 'a.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'old\n',
          newContent: 'different\n',
        },
      ],
      { ...source, capturedAt: '2026-08-28T08:00:00.000Z' },
    )

    expect(morning.captureId).toBe(evening.captureId)
    expect(changed.captureId).not.toBe(morning.captureId)
    expect(
      captureIdFor([
        {
          path: 'a.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'old\n',
          newContent: 'new\n',
        },
      ]),
    ).toBe(morning.captureId)
  })

  test('captureId is independent of file array order', () => {
    const files = [
      {
        path: 'b.ts',
        status: 'modified' as const,
        ...regularModes,
        oldContent: '1\n',
        newContent: '2\n',
      },
      {
        path: 'a.ts',
        status: 'modified' as const,
        ...regularModes,
        oldContent: 'x\n',
        newContent: 'y\n',
      },
    ]
    const shuffled = [files[1]!, files[0]!]
    expect(captureIdFor(files)).toBe(captureIdFor(shuffled))
  })

  test('captureId includes file modes', () => {
    const regular = {
      path: 'script.sh',
      status: 'added' as const,
      oldMode: '000000' as const,
      newMode: '100644' as const,
      oldContent: '',
      newContent: '#!/bin/sh\n',
    }

    expect(captureIdFor([regular])).not.toBe(
      captureIdFor([{ ...regular, newMode: '100755' }]),
    )
  })

  test('change IDs are assigned in sorted file order', () => {
    const capture = createExplainCapture(
      [
        {
          path: 'z.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'a\n',
          newContent: 'b\n',
        },
        {
          path: 'a.ts',
          status: 'modified',
          ...regularModes,
          oldContent: 'c\n',
          newContent: 'd\n',
        },
      ],
      source,
    )

    expect(capture.changes.map((change) => change.path)).toEqual(['a.ts', 'z.ts'])
    expect(capture.changes.map((change) => change.id)).toEqual(['change-001', 'change-002'])
  })

  test('emits placeholder blocks for added, deleted, and pure renamed files', () => {
    const capture = createExplainCapture(
      [
        {
          path: 'added.ts',
          status: 'added',
          oldMode: '000000',
          newMode: '100644',
          oldContent: '',
          newContent: 'added\n',
        },
        {
          path: 'deleted.ts',
          status: 'deleted',
          oldMode: '100644',
          newMode: '000000',
          oldContent: 'deleted\n',
          newContent: '',
        },
        {
          path: 'new-name.ts',
          oldPath: 'old-name.ts',
          status: 'renamed',
          ...regularModes,
          oldContent: 'same\n',
          newContent: 'same\n',
        },
      ],
      source,
    )

    expect(capture.changes.map((change) => change.id)).toEqual([
      'change-001',
      'change-002',
      'change-003',
    ])
    expect(capture.changes.map((change) => change.path)).toEqual([
      'added.ts',
      'deleted.ts',
      'new-name.ts',
    ])
  })
})

describe('explain materialization', () => {
  test('emits pure rename metadata that Pierre parses with both paths and modes', () => {
    const capture = createExplainCapture(
      [
        {
          path: 'bin/new-name.sh',
          oldPath: 'bin/old-name.sh',
          status: 'renamed',
          oldMode: '100644',
          newMode: '100755',
          oldContent: '#!/bin/sh\necho same\n',
          newContent: '#!/bin/sh\necho same\n',
        },
      ],
      source,
    )

    const document = materializeExplainDocument(capture, allChangesAssigned(capture))
    const patch = document.sections[0]!.steps[0]!.diff!

    expect(patch).toContain('old mode 100644\nnew mode 100755')
    expect(patch).toContain(
      'similarity index 100%\nrename from bin/old-name.sh\nrename to bin/new-name.sh',
    )
    expect(patch).not.toContain('--- a/bin/old-name.sh')
    expect(patch).not.toContain('@@ ')
    expect(parseSectionPatch(patch)).toEqual([
      expect.objectContaining({
        name: 'bin/new-name.sh',
        prevName: 'bin/old-name.sh',
        type: 'rename-pure',
        prevMode: '100644',
        mode: '100755',
        hunks: [],
      }),
    ])
  })

  test('keeps hunks in renames whose content changed', () => {
    const capture = createExplainCapture(
      [
        {
          path: 'new-name.ts',
          oldPath: 'old-name.ts',
          status: 'renamed',
          ...regularModes,
          oldContent: 'old\n',
          newContent: 'new\n',
        },
      ],
      source,
    )

    const document = materializeExplainDocument(capture, allChangesAssigned(capture))
    const patch = document.sections[0]!.steps[0]!.diff!
    const [file] = parseSectionPatch(patch)

    expect(patch).not.toContain('similarity index 100%')
    expect(patch).toContain('@@ -1,1 +1,1 @@')
    expect(file).toMatchObject({
      name: 'new-name.ts',
      prevName: 'old-name.ts',
      type: 'rename-changed',
    })
    expect(fileDiffStats(file!)).toEqual({ additions: 1, deletions: 1 })
  })

  test('emits executable modes and textual hunks for additions and deletions', () => {
    const capture = createExplainCapture(
      [
        {
          path: 'added.sh',
          status: 'added',
          oldMode: '000000',
          newMode: '100755',
          oldContent: '',
          newContent: '#!/bin/sh\necho added\n',
        },
        {
          path: 'deleted.sh',
          status: 'deleted',
          oldMode: '100755',
          newMode: '000000',
          oldContent: '#!/bin/sh\necho deleted\n',
          newContent: '',
        },
      ],
      source,
    )

    const document = materializeExplainDocument(capture, {
      captureId: capture.captureId,
      title: 'Executable files',
      summary: '',
      sections: [
        {
          title: 'Scripts',
          steps: [{ text: '', changes: capture.changes.map((change) => change.id) }],
        },
      ],
    })
    const patch = document.sections[0]!.steps[0]!.diff!

    expect(patch).toContain('new file mode 100755')
    expect(patch).toContain('deleted file mode 100755')
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('@@ -1,2 +0,0 @@')
    expect(parseSectionPatch(patch)).toHaveLength(2)
  })

  test('materializes each step as an independently parseable Git patch', () => {
    const capture = captureWithTwoChanges()
    const explanations = {
      captureId: capture.captureId,
      title: 'Two changes, explained out of order',
      summary: 'An opening that orients the reader.',
      sections: [
        {
          title: 'Later change first',
          steps: [{ text: 'Explain E before B.', changes: ['change-002'] }],
        },
        {
          title: 'Earlier change second',
          steps: [{ text: 'Then explain B.', changes: ['change-001'] }],
        },
      ],
    }

    const document = materializeExplainDocument(capture, explanations)

    expect(document.formatVersion).toBe(1)
    expect(document.title).toBe('Two changes, explained out of order')
    expect(document.summary).toBe('An opening that orients the reader.')
    expect(document.source).toEqual(capture.source)
    expect(document.sections.map((section) => section.title)).toEqual([
      'Later change first',
      'Earlier change second',
    ])
    expect(document.sections[0]!.steps[0]!.diff).toContain('+E')
    expect(document.sections[0]!.steps[0]!.diff).not.toContain('+B')
    expect(document.sections[0]!.steps[0]!.changes).toEqual(['change-002'])
    expect(document.sections[1]!.steps[0]!.diff).toContain('+B')
    expect(document.sections[1]!.steps[0]!.diff).not.toContain('+E')
    expect(document.sections[1]!.steps[0]!.changes).toEqual(['change-001'])
    for (const section of document.sections) {
      expect(parseSectionPatch(section.steps[0]!.diff!)).toHaveLength(1)
    }
  })

  test('interleaves text-only steps with steps that carry a diff', () => {
    const capture = captureWithTwoChanges()
    const explanations = {
      captureId: capture.captureId,
      title: 'Interleaved',
      summary: '',
      sections: [
        {
          title: 'Build the argument in order',
          steps: [
            { text: 'First the setup, with no diff of its own.' },
            { text: 'Then the change it prepares.', changes: ['change-001'] },
            { text: 'And finally the payoff.', changes: ['change-002'] },
          ],
        },
      ],
    }

    const document = materializeExplainDocument(capture, explanations)
    const steps = document.sections[0]!.steps

    expect(steps).toHaveLength(3)
    expect(steps[0]!.diff).toBeUndefined()
    expect(steps[0]!.changes).toBeUndefined()
    expect(steps[1]!.diff).toContain('+B')
    expect(steps[1]!.changes).toEqual(['change-001'])
    expect(steps[2]!.diff).toContain('+E')
    expect(steps[2]!.changes).toEqual(['change-002'])
  })

  test('requires the explanations to target the captured captureId', () => {
    const capture = captureWithTwoChanges()
    const explanations = allChangesAssigned(capture)
    explanations.captureId = 'f'.repeat(64)

    expect(() => materializeExplainDocument(capture, explanations)).toThrow(/capture /)
  })

  test('requires every change to be shown at least once and to be known', () => {
    const capture = captureWithTwoChanges()

    const unexplained = {
      captureId: capture.captureId,
      title: 'Partial',
      summary: '',
      sections: [{ title: 'One', steps: [{ text: '', changes: ['change-001'] }] }],
    }
    expect(() => materializeExplainDocument(capture, unexplained)).toThrow(
      'Unassigned change IDs: change-002',
    )

    const unknown = {
      captureId: capture.captureId,
      title: 'Unknown',
      summary: '',
      sections: [{ title: 'Unknown', steps: [{ text: '', changes: ['change-999'] }] }],
    }
    expect(() => materializeExplainDocument(capture, unknown)).toThrow(
      'Unknown change ID: change-999',
    )
  })

  // Re-showing a hunk is how an author builds an argument, so it materializes twice
  // instead of failing. `check` reports the repeat; only an unexplained change fails.
  test('allows the same change to be shown more than once', () => {
    const capture = captureWithTwoChanges()
    const explanations = {
      captureId: capture.captureId,
      title: 'Shown twice',
      summary: '',
      sections: [
        { title: 'For context', steps: [{ text: 'A first look.', changes: ['change-001'] }] },
        {
          title: 'In detail',
          steps: [{ text: 'The same hunk, argued.', changes: ['change-001', 'change-002'] }],
        },
      ],
    }

    const document = materializeExplainDocument(capture, explanations)

    expect(document.sections[0]!.steps[0]!.diff).toContain('+B')
    expect(document.sections[1]!.steps[0]!.diff).toContain('+B')
    expect(duplicatedChangeIds(explanations)).toEqual(['change-001'])
  })

  test('reports nothing duplicated when every change is shown once', () => {
    const capture = captureWithTwoChanges()
    expect(duplicatedChangeIds(allChangesAssigned(capture))).toEqual([])
  })

  test('preserves the authored explainedBy attribution and omits absent metadata', () => {
    const capture = captureWithTwoChanges()

    const attributed = {
      ...allChangesAssigned(capture),
      metadata: { explainedBy: 'Claude Code' },
    }
    expect(materializeExplainDocument(capture, attributed).metadata).toEqual({
      explainedBy: 'Claude Code',
    })

    expect(materializeExplainDocument(capture, allChangesAssigned(capture)).metadata).toBeUndefined()
  })

  test('rejects a change block that no longer matches captured content', () => {
    const capture = captureWithTwoChanges()
    const explanations = allChangesAssigned(capture)
    const tampered: ExplainCapture = structuredClone(capture)
    tampered.changes[0]!.before = 'WRONG\n'

    expect(() => materializeExplainDocument(tampered, explanations)).toThrow(
      'no longer matches captured file content',
    )
  })

  test('rejects a capture with duplicate change IDs', () => {
    const capture = captureWithTwoChanges()
    capture.changes[1]!.id = 'change-001'

    expect(() => materializeExplainDocument(capture, allChangesAssigned(capture))).toThrow(
      'Capture contains duplicate change IDs',
    )
  })
})
