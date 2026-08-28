import { describe, expect, test } from 'bun:test'
import { parseExplainSectionsJson } from '../src/document'

describe('parseExplainSectionsJson', () => {
  test('reads explain and diff sections directly', () => {
    const sections = parseExplainSectionsJson(
      JSON.stringify({
        formatVersion: 1,
        source: { kind: 'proposed' },
        sections: [
          {
            explain: { title: 'A direct section', body: 'No range mapping is needed.' },
            diff: [
              'diff --git a/example.ts b/example.ts',
              '--- a/example.ts',
              '+++ b/example.ts',
              '@@ -1 +1 @@',
              '-old',
              '+new',
              '',
            ].join('\n'),
          },
        ],
      }),
    )

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      id: 'explanation:0',
      title: 'A direct section',
      body: 'No range mapping is needed.',
    })
    expect(sections[0]!.files).toHaveLength(1)
  })

  test('requires at least one section', () => {
    expect(() =>
      parseExplainSectionsJson(
        JSON.stringify({ formatVersion: 1, source: { kind: 'proposed' }, sections: [] }),
      ),
    ).toThrow()
  })
})
