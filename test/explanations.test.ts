import { describe, expect, test } from 'bun:test'
import { parseExplanations } from '../src/explanations'

const captureId = 'a'.repeat(64)

const validYaml = `captureId: ${captureId}
sections:
  - title: Keep the greeting concise
    body: |
      The extra phrase is no longer needed.
    changes:
      - change-001
  - title: With a fragment
    html: "<figure><svg viewBox=\\"0 0 1 1\\"></svg></figure>"
    changes:
      - change-002
      - change-003
`

describe('parseExplanations', () => {
  test('parses ordered sections with title, body, optional html, and change IDs', () => {
    const explanations = parseExplanations(validYaml)

    expect(explanations.captureId).toBe(captureId)
    expect(explanations.sections).toEqual([
      {
        title: 'Keep the greeting concise',
        body: 'The extra phrase is no longer needed.\n',
        changes: ['change-001'],
      },
      {
        title: 'With a fragment',
        body: '',
        html: '<figure><svg viewBox="0 0 1 1"></svg></figure>',
        changes: ['change-002', 'change-003'],
      },
    ])
  })

  test('uses YAML 1.2 core scalar rules, not YAML 1.1 coercion', () => {
    const explanations = parseExplanations(`captureId: ${captureId}
sections:
  - title: yes
    body: "2026-08-28"
    changes:
      - change-001
`)
    expect(explanations.sections[0]!.title).toBe('yes')
    expect(explanations.sections[0]!.body).toBe('2026-08-28')
  })

  test('rejects custom tags instead of silently coercing them', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: !custom flagged
    changes:
      - change-001
`),
    ).toThrow('Invalid explanations YAML')
  })

  test('rejects duplicate keys', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
captureId: ${captureId}
sections: []
`),
    ).toThrow('Invalid explanations YAML')
  })

  test('rejects anchors and aliases', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: &shared Shared
    changes:
      - change-001
  - title: *shared
    changes:
      - change-002
`),
    ).toThrow()
  })

  test('rejects an empty document', () => {
    expect(() => parseExplanations('')).toThrow('the document is empty')
  })

  test('rejects numbers, booleans, and nulls where strings are expected', () => {
    expect(() =>
      parseExplanations(`captureId: 12345
sections: []
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: true
    changes:
      - change-001
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`captureId:
sections: []
`),
    ).toThrow()
  })

  test('schema violations name the offending field and expected type', () => {
    expect(() =>
      parseExplanations(`captureId: 12345
sections: []
`),
    ).toThrow(/captureId: Invalid input: expected string/)
  })

  test('a bare body value behaves like an omitted body', () => {
    const explanations = parseExplanations(`captureId: ${captureId}
sections:
  - title: Terse
    body:
    changes:
      - change-001
`)

    expect(explanations.sections[0]!.body).toBe('')
  })

  test('rejects a section without changes or with empty change IDs', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: No changes
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: Empty id
    changes:
      - ""
`),
    ).toThrow()
  })

  test('rejects unknown top-level fields and per-section fields', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections: []
extra: nope
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`captureId: ${captureId}
sections:
  - title: Extra field
    explain: {}
    changes:
      - change-001
`),
    ).toThrow()
  })
})
