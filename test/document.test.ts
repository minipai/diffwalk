import { describe, expect, test } from 'bun:test'
import { parseExplainSectionsJson } from '../src/document'

const diff = [
  'diff --git a/example.ts b/example.ts',
  '--- a/example.ts',
  '+++ b/example.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n')

describe('parseExplainSectionsJson', () => {
  test('reads section steps directly', () => {
    const sections = parseExplainSectionsJson(
      JSON.stringify({
        formatVersion: 1,
        title: 'A direct document',
        summary: '',
        source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
        sections: [
          {
            title: 'A direct section',
            steps: [{ text: 'No range mapping is needed.', diff }],
          },
        ],
      }),
    )

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ id: 'explanation:0', title: 'A direct section' })
    expect(sections[0]!.steps).toHaveLength(1)
    expect(sections[0]!.steps[0]).toMatchObject({
      id: 'explanation:0/step:0',
      text: 'No range mapping is needed.',
    })
    expect(sections[0]!.steps[0]!.files).toHaveLength(1)
  })

  test('keeps a text-only step without any files', () => {
    const sections = parseExplainSectionsJson(
      JSON.stringify({
        formatVersion: 1,
        title: 'Interleaved',
        summary: '',
        source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
        sections: [
          {
            title: 'Prose then diff',
            steps: [{ text: 'Why this matters.' }, { text: 'What it looks like.', diff }],
          },
        ],
      }),
    )

    expect(sections[0]!.steps.map((step) => step.files.length)).toEqual([0, 1])
  })

  test('requires at least one section', () => {
    expect(() =>
      parseExplainSectionsJson(
        JSON.stringify({
          formatVersion: 1,
          title: 'Empty',
          summary: '',
          source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
          sections: [],
        }),
      ),
    ).toThrow()
  })
})
