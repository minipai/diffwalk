import { describe, expect, test } from 'bun:test'
import { defaultReportOutput, parseReportArgs } from '../src/cli-args'

describe('parseReportArgs', () => {
  test('accepts a document and derives the default output path', () => {
    expect(parseReportArgs(['.explain/document.json'])).toEqual({
      document: '.explain/document.json',
      output: '.explain/document.html',
    })
  })

  test('accepts an explicit output flag', () => {
    expect(parseReportArgs(['document.json', '--output', 'report.html'])).toEqual({
      document: 'document.json',
      output: 'report.html',
    })
  })

  test('accepts --output before the document', () => {
    expect(parseReportArgs(['--output', 'out.html', 'doc.json'])).toEqual({
      document: 'doc.json',
      output: 'out.html',
    })
  })

  test('defaultReportOutput appends .html when there is no .json suffix', () => {
    expect(defaultReportOutput('doc')).toBe('doc.html')
  })

  test('rejects anything but exactly one document', () => {
    expect(() => parseReportArgs([])).toThrow(
      'Expected: diffwalk report <document.json> [--output report.html]',
    )
    expect(() => parseReportArgs(['a.json', 'b.json'])).toThrow(
      'Expected: diffwalk report <document.json> [--output report.html]',
    )
  })

  test('rejects unknown options', () => {
    expect(() => parseReportArgs(['a.json', '--bogus', 'x'])).toThrow('Unknown option: --bogus')
  })

  test('rejects a missing or duplicate --output value', () => {
    expect(() => parseReportArgs(['a.json', '--output'])).toThrow('Missing value for --output')
    expect(() => parseReportArgs(['a.json', '--output', 'x', '--output', 'y'])).toThrow(
      'Duplicate option: --output',
    )
  })

  test('rejects empty or flag-shaped --output values', () => {
    expect(() => parseReportArgs(['a.json', '--output', ''])).toThrow('Invalid value for --output')
    expect(() => parseReportArgs(['a.json', '--output', '--weird'])).toThrow(
      'Invalid value for --output',
    )
  })
})