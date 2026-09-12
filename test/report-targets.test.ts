import { describe, expect, test } from 'bun:test'
import type { ExplainDocument } from '../src/format/types'
import { reportTargets } from '../src/report/targets'

function document(sections: ExplainDocument['sections']): ExplainDocument {
  return {
    formatVersion: 1,
    title: 'Targets',
    summary: '',
    source: { kind: 'proposal', capturedAt: '2026-09-09T00:00:00.000Z' },
    sections,
  }
}

function fragmentsByText(value: ExplainDocument) {
  const targets = reportTargets(value)
  return new Map(
    value.sections.flatMap((section, sectionIndex) =>
      section.steps.map((step, stepIndex) => [
        step.text,
        {
          section: targets[sectionIndex]!.fragment,
          step: targets[sectionIndex]!.steps[stepIndex]!.fragment,
        },
      ] as const),
    ),
  )
}

describe('report targets', () => {
  test('section and step fragments stay with their content when unrelated items are reordered', () => {
    const first = { title: 'Repeated title', steps: [{ text: 'Alpha.' }] }
    const second = { title: 'Repeated title', steps: [{ text: 'Beta.' }] }
    const other = { title: 'Other', steps: [{ text: 'Gamma.' }] }

    const before = fragmentsByText(document([first, second, other]))
    const after = fragmentsByText(document([other, second, first]))

    expect(after.get('Alpha.')).toEqual(before.get('Alpha.'))
    expect(after.get('Beta.')).toEqual(before.get('Beta.'))
    expect(after.get('Gamma.')).toEqual(before.get('Gamma.'))
    expect(new Set([...before.values()].map((target) => target.section)).size).toBe(3)
  })

  test('step fragments stay with their content when sibling steps are reordered', () => {
    const beforeValue = document([
      {
        title: 'One section',
        steps: [{ text: 'Alpha.' }, { text: 'Beta.' }, { text: 'Gamma.' }],
      },
    ])
    const afterValue = document([
      {
        title: 'One section',
        steps: [{ text: 'Gamma.' }, { text: 'Alpha.' }, { text: 'Beta.' }],
      },
    ])

    const before = fragmentsByText(beforeValue)
    const after = fragmentsByText(afterValue)
    expect(after).toEqual(before)
  })

  test('sibling edits and additions preserve step targets and repeated-change ownership', () => {
    const recurring = (text: string, patch: string) => ({
      text,
      diff: patch,
      changes: ['change-007'],
    })
    const beforeValue = document([
      {
        title: 'Stable parent',
        steps: [
          recurring('First occurrence.', 'patch one'),
          { text: 'Unrelated sibling.' },
          recurring('Second occurrence.', 'patch two'),
        ],
      },
    ])
    const afterValue = document([
      {
        title: 'Stable parent',
        steps: [
          { text: 'A newly added sibling.' },
          recurring('Second occurrence.', 'patch two'),
          { text: 'Edited unrelated sibling.' },
          recurring('First occurrence.', 'patch one'),
        ],
      },
    ])

    const occurrenceTargets = (value: ExplainDocument) => {
      const targets = reportTargets(value)
      return new Map(
        value.sections[0]!.steps
          .map((step, index) => ({ step, target: targets[0]!.steps[index]! }))
          .filter(({ step }) => step.changes?.includes('change-007'))
          .map(({ step, target }) => [
            step.text,
            {
              fragment: target.fragment,
              canonical: target.changes.some((change) => change.canonical),
            },
          ]),
      )
    }

    const before = occurrenceTargets(beforeValue)
    const after = occurrenceTargets(afterValue)
    expect(after).toEqual(before)
    expect([...before.values()].filter((target) => target.canonical)).toHaveLength(1)
  })

  test('same-titled sections keep identical target steps with their distinct contexts', () => {
    const targetStep = {
      text: 'Shared target.',
      diff: 'shared patch',
      changes: ['change-007'],
    }
    const contextA = {
      title: 'Repeated section',
      steps: [targetStep, { text: 'Context A.' }],
    }
    const contextB = {
      title: 'Repeated section',
      steps: [targetStep, { text: 'Context B.' }],
    }
    const beforeValue = document([contextA, contextB])
    const afterValue = document([contextB, contextA])

    const targetsByContext = (value: ExplainDocument) => {
      const targets = reportTargets(value)
      return new Map(
        value.sections.map((section, sectionIndex) => {
          const context = section.steps.find((step) => step.text.startsWith('Context '))!.text
          const target = targets[sectionIndex]!.steps[0]!
          return [
            context,
            {
              fragment: target.fragment,
              canonical: target.changes[0]!.canonical,
            },
          ]
        }),
      )
    }

    const before = targetsByContext(beforeValue)
    const after = targetsByContext(afterValue)
    expect(after).toEqual(before)
    expect(new Set([...before.values()].map((target) => target.fragment)).size).toBe(2)
    expect([...before.values()].filter((target) => target.canonical)).toHaveLength(1)
  })

  test('duplicate identical sections receive deterministic collision suffixes', () => {
    const repeated = { title: 'Same section', steps: [{ text: 'Same step.' }] }
    const other = { title: 'Other section', steps: [{ text: 'Other step.' }] }

    const before = reportTargets(document([repeated, other, repeated])).map(
      (section) => section.fragment,
    )
    const after = reportTargets(document([other, repeated, repeated])).map(
      (section) => section.fragment,
    )

    expect(before[2]).toBe(`${before[0]}-2`)
    expect(after.slice(1)).toEqual([before[0], before[2]])
  })

  test('structurally identical text-only steps receive deterministic collision suffixes', () => {
    const value = document([
      {
        title: 'Duplicates',
        steps: [{ text: 'Same words.' }, { text: 'Unrelated.' }, { text: 'Same words.' }],
      },
    ])
    const reordered = document([
      {
        title: 'Duplicates',
        steps: [{ text: 'Same words.' }, { text: 'Same words.' }, { text: 'Unrelated.' }],
      },
    ])

    const fragments = reportTargets(value)[0]!.steps.map((step) => step.fragment)
    const reorderedFragments = reportTargets(reordered)[0]!.steps.map((step) => step.fragment)
    expect(fragments[0]).not.toBe(fragments[2])
    expect(fragments[2]).toBe(`${fragments[0]}-2`)
    expect(reorderedFragments.slice(0, 2)).toEqual([fragments[0], fragments[2]])
    expect(reorderedFragments[2]).toBe(fragments[1])
  })

  test('change fragments derive from IDs and choose a stable canonical repeated occurrence', () => {
    const value = document([
      {
        title: 'Later',
        steps: [{ text: 'Second reference.', diff: 'patch', changes: ['change-007'] }],
      },
      {
        title: 'Earlier',
        steps: [
          { text: 'First reference.', diff: 'patch', changes: ['change-007', 'odd / ID'] },
        ],
      },
    ])
    const reordered = document([value.sections[1]!, value.sections[0]!])
    const targets = reportTargets(value)
    const nextTargets = reportTargets(reordered)
    const change = targets.flatMap((section) => section.steps.flatMap((step) => step.changes))
    const next = nextTargets.flatMap((section) => section.steps.flatMap((step) => step.changes))

    expect(change.filter((target) => target.id === 'change-007').map((target) => target.fragment)).toEqual([
      'change-007',
      'change-007',
    ])
    expect(change.filter((target) => target.id === 'change-007' && target.canonical)).toHaveLength(1)
    expect(next.find((target) => target.id === 'change-007' && target.canonical)?.fragment).toBe(
      'change-007',
    )
    expect(change.find((target) => target.id === 'odd / ID')?.fragment).toBe('change-odd-id')
  })

  test('slug collisions are disambiguated by content rather than document order', () => {
    const first = document([
      {
        title: 'Collisions',
        steps: [
          { text: 'One.', diff: 'patch one', changes: ['odd / ID'] },
          { text: 'Two.', diff: 'patch two', changes: ['odd-ID'] },
        ],
      },
    ])
    const second = document([
      {
        title: 'Collisions',
        steps: [
          { text: 'Two.', diff: 'patch two', changes: ['odd-ID'] },
          { text: 'One.', diff: 'patch one', changes: ['odd / ID'] },
        ],
      },
    ])

    const fragments = new Map(
      reportTargets(first)[0]!.steps.flatMap((step) =>
        step.changes.map((change) => [change.id, change.fragment] as const),
      ),
    )
    const reordered = new Map(
      reportTargets(second)[0]!.steps.flatMap((step) =>
        step.changes.map((change) => [change.id, change.fragment] as const),
      ),
    )

    expect(new Set(fragments.values()).size).toBe(2)
    expect(reordered).toEqual(fragments)
  })
})
