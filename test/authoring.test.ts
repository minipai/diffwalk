import { describe, expect, test } from 'bun:test'
import { createHunkDiffFilesFromPatch } from 'hunkdiff/opentui'
import {
  captureIdFor,
  createExplainCapture,
  materializeExplainDocument,
} from '../src/authoring'
import type { CaptureSource, ExplainCapture } from '../src/format'

const source: CaptureSource = {
  kind: 'working-tree',
  from: { revision: 'HEAD', commit: '0123456789abcdef' },
  capturedAt: '2026-08-28T00:00:00.000Z',
}

function captureWithTwoChanges(): ExplainCapture {
  return createExplainCapture(
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

function allChangesAssigned(capture: ExplainCapture) {
  return {
    captureId: capture.captureId,
    sections: capture.changes.map((change, index) => ({
      title: `Section ${index + 1}`,
      body: '',
      changes: [change.id],
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
      [{ path: 'a.ts', status: 'modified', oldContent: 'old\n', newContent: 'new\n' }],
      { ...source, capturedAt: '2026-08-28T08:00:00.000Z' },
    )
    const evening = createExplainCapture(
      [{ path: 'a.ts', status: 'modified', oldContent: 'old\n', newContent: 'new\n' }],
      { ...source, capturedAt: '2026-08-28T20:00:00.000Z' },
    )
    const changed = createExplainCapture(
      [{ path: 'a.ts', status: 'modified', oldContent: 'old\n', newContent: 'different\n' }],
      { ...source, capturedAt: '2026-08-28T08:00:00.000Z' },
    )

    expect(morning.captureId).toBe(evening.captureId)
    expect(changed.captureId).not.toBe(morning.captureId)
    expect(
      captureIdFor([
        { path: 'a.ts', status: 'modified', oldContent: 'old\n', newContent: 'new\n' },
      ]),
    ).toBe(morning.captureId)
  })

  test('captureId is independent of file array order', () => {
    const files = [
      { path: 'b.ts', status: 'modified' as const, oldContent: '1\n', newContent: '2\n' },
      { path: 'a.ts', status: 'modified' as const, oldContent: 'x\n', newContent: 'y\n' },
    ]
    const shuffled = [files[1]!, files[0]!]
    expect(captureIdFor(files)).toBe(captureIdFor(shuffled))
  })

  test('change IDs are assigned in sorted file order', () => {
    const capture = createExplainCapture(
      [
        { path: 'z.ts', status: 'modified', oldContent: 'a\n', newContent: 'b\n' },
        { path: 'a.ts', status: 'modified', oldContent: 'c\n', newContent: 'd\n' },
      ],
      source,
    )

    expect(capture.changes.map((change) => change.path)).toEqual(['a.ts', 'z.ts'])
    expect(capture.changes.map((change) => change.id)).toEqual(['change-001', 'change-002'])
  })

  test('emits placeholder blocks for added, deleted, and pure renamed files', () => {
    const capture = createExplainCapture(
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
  test('materializes each explanation as an independently parseable Git patch', () => {
    const capture = captureWithTwoChanges()
    const explanations = {
      captureId: capture.captureId,
      sections: [
        { title: 'Later change first', body: 'Explain E before B.', changes: ['change-002'] },
        { title: 'Earlier change second', body: 'Then explain B.', changes: ['change-001'] },
      ],
    }

    const document = materializeExplainDocument(capture, explanations)

    expect(document.formatVersion).toBe(1)
    expect(document.source).toEqual(capture.source)
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

  test('requires the explanations to target the captured captureId', () => {
    const capture = captureWithTwoChanges()
    const explanations = allChangesAssigned(capture)
    explanations.captureId = 'f'.repeat(64)

    expect(() => materializeExplainDocument(capture, explanations)).toThrow(
      /capture /,
    )
  })

  test('requires every change ID exactly once', () => {
    const capture = captureWithTwoChanges()

    const unassigned = {
      captureId: capture.captureId,
      sections: [{ title: 'One', body: '', changes: ['change-001'] }],
    }
    expect(() => materializeExplainDocument(capture, unassigned)).toThrow(
      'Unassigned change IDs: change-002',
    )

    const duplicate = {
      captureId: capture.captureId,
      sections: [
        { title: 'One', body: '', changes: ['change-001'] },
        { title: 'Again', body: '', changes: ['change-001', 'change-002'] },
      ],
    }
    expect(() => materializeExplainDocument(capture, duplicate)).toThrow('assigned more than once')

    const unknown = {
      captureId: capture.captureId,
      sections: [{ title: 'Unknown', body: '', changes: ['change-999'] }],
    }
    expect(() => materializeExplainDocument(capture, unknown)).toThrow('Unknown change ID: change-999')
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

  test('rejects a section that lists the same change ID twice', () => {
    const capture = captureWithTwoChanges()
    const explanations = {
      captureId: capture.captureId,
      sections: [
        { title: 'Repeated', body: '', changes: ['change-001', 'change-001'] },
        { title: 'Other', body: '', changes: ['change-002'] },
      ],
    }

    expect(() => materializeExplainDocument(capture, explanations)).toThrow(
      'assigned more than once',
    )
  })

  test('carries optional html through materialization', () => {
    const capture = captureWithTwoChanges()
    const fragment = '<figure><svg viewBox="0 0 640 180" role="img"><rect width="10" height="10"/></svg></figure>'
    const explanations = {
      captureId: capture.captureId,
      sections: [
        { title: 'Later change first', body: 'Explain E before B.', html: fragment, changes: ['change-002'] },
        { title: 'Earlier change second', body: 'Then explain B.', changes: ['change-001'] },
      ],
    }

    const document = materializeExplainDocument(capture, explanations)

    expect(document.sections[0]!.explain.html).toBe(fragment)
    expect(document.sections[0]!.explain.body).toBe('Explain E before B.')
    expect(document.sections[1]!.explain.html).toBeUndefined()
    for (const section of document.sections) {
      expect(createHunkDiffFilesFromPatch(section.diff)).toHaveLength(1)
    }
  })
})
