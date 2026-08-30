import { describe, expect, test } from 'bun:test'
import { parseExplanations } from '../src/explanations'

const captureId = 'a'.repeat(64)
const head = `captureId: ${captureId}\ntitle: A change set\n`

const validYaml = `${head}summary: |
  What this change set is about.
sections:
  - title: Keep the greeting concise
    steps:
      - text: |
          The extra phrase is no longer needed.
        changes:
          - change-001
  - title: With a diagram
    steps:
      - text: "<figure><svg viewBox=\\"0 0 1 1\\"></svg></figure>"
      - changes:
          - change-002
          - change-003
`

describe('parseExplanations', () => {
  test('parses a title, a summary, and ordered sections of steps', () => {
    const explanations = parseExplanations(validYaml)

    expect(explanations.captureId).toBe(captureId)
    expect(explanations.title).toBe('A change set')
    expect(explanations.summary).toBe('What this change set is about.\n')
    expect(explanations.sections).toEqual([
      {
        title: 'Keep the greeting concise',
        steps: [
          { text: 'The extra phrase is no longer needed.\n', changes: ['change-001'] },
        ],
      },
      {
        title: 'With a diagram',
        steps: [
          { text: '<figure><svg viewBox="0 0 1 1"></svg></figure>' },
          { text: '', changes: ['change-002', 'change-003'] },
        ],
      },
    ])
  })

  test('uses YAML 1.2 core scalar rules, not YAML 1.1 coercion', () => {
    const explanations = parseExplanations(`${head}sections:
  - title: yes
    steps:
      - text: "2026-08-28"
        changes:
          - change-001
`)
    expect(explanations.sections[0]!.title).toBe('yes')
    expect(explanations.sections[0]!.steps[0]!.text).toBe('2026-08-28')
  })

  test('rejects custom tags instead of silently coercing them', () => {
    expect(() =>
      parseExplanations(`${head}sections:
  - title: !custom flagged
    steps:
      - changes:
          - change-001
`),
    ).toThrow('Invalid explanations YAML')
  })

  test('rejects duplicate keys', () => {
    expect(() =>
      parseExplanations(`captureId: ${captureId}
captureId: ${captureId}
title: A change set
sections: []
`),
    ).toThrow('Invalid explanations YAML')
  })

  test('rejects anchors and aliases', () => {
    expect(() =>
      parseExplanations(`${head}sections:
  - title: &shared Shared
    steps:
      - changes: [change-001]
  - title: *shared
    steps:
      - changes: [change-002]
`),
    ).toThrow()
  })

  test('rejects an empty document', () => {
    expect(() => parseExplanations('')).toThrow('the document is empty')
  })

  test('rejects numbers, booleans, and nulls where strings are expected', () => {
    expect(() => parseExplanations(`captureId: 12345\ntitle: A\nsections: []\n`)).toThrow()
    expect(() =>
      parseExplanations(`${head}sections:
  - title: true
    steps:
      - changes: [change-001]
`),
    ).toThrow()
    expect(() => parseExplanations(`captureId:\ntitle: A\nsections: []\n`)).toThrow()
  })

  test('requires a document title', () => {
    expect(() => parseExplanations(`captureId: ${captureId}\nsections: []\n`)).toThrow(
      /title/,
    )
  })

  test('schema violations name the offending field and expected type', () => {
    expect(() => parseExplanations(`captureId: 12345\ntitle: A\nsections: []\n`)).toThrow(
      /captureId: Invalid input: expected string/,
    )
  })

  test('a bare text value behaves like an omitted one', () => {
    const explanations = parseExplanations(`${head}sections:
  - title: Terse
    steps:
      - text:
        changes:
          - change-001
`)

    expect(explanations.sections[0]!.steps[0]!.text).toBe('')
  })

  test('a summary is optional and defaults to empty', () => {
    const explanations = parseExplanations(`${head}sections: []\n`)
    expect(explanations.summary).toBe('')
  })

  test('rejects a step with neither text nor changes', () => {
    expect(() =>
      parseExplanations(`${head}sections:
  - title: Empty step
    steps:
      - text: ""
`),
    ).toThrow(/text, changes, or both/)
  })

  test('rejects a section without steps or with empty change IDs', () => {
    expect(() =>
      parseExplanations(`${head}sections:
  - title: No steps
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`${head}sections:
  - title: Empty id
    steps:
      - changes:
          - ""
`),
    ).toThrow()
  })

  test('rejects unknown top-level, per-section, and per-step fields', () => {
    expect(() => parseExplanations(`${head}sections: []\nextra: nope\n`)).toThrow()
    expect(() =>
      parseExplanations(`${head}sections:
  - title: Extra field
    body: gone
    steps:
      - changes: [change-001]
`),
    ).toThrow()
    expect(() =>
      parseExplanations(`${head}sections:
  - title: Extra step field
    steps:
      - html: gone
        changes: [change-001]
`),
    ).toThrow()
  })
})
