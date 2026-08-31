import { describe, expect, test } from 'bun:test'
import { parseArgs, requirePositionalCount, UsageError } from '../src/cli-args'

const reportSpecs = [
  { name: 'input', takesValue: true },
  { name: 'explanations', takesValue: true },
  { name: 'output', takesValue: true },
]

describe('parseArgs', () => {
  test('collects value flags and positionals', () => {
    const parsed = parseArgs(['--input', '.diffwalk/walk/capture.json', 'some', 'args'], reportSpecs)

    expect(parsed.flags.input).toBe('.diffwalk/walk/capture.json')
    expect(parsed.positionals).toEqual(['some', 'args'])
    expect(parsed.help).toBe(false)
  })

  test('boolean flags are recorded without a value', () => {
    const parsed = parseArgs(['--json'], [{ name: 'json', takesValue: false }])

    expect(parsed.flags.json).toBe(true)
  })

  test('--help and -h set the help flag anywhere in the arguments', () => {
    expect(parseArgs(['--help'], reportSpecs).help).toBe(true)
    expect(parseArgs(['-h'], reportSpecs).help).toBe(true)
    expect(parseArgs(['--input', 'x', '--help'], reportSpecs).help).toBe(true)
  })

  test('rejects unknown options', () => {
    expect(() => parseArgs(['--bogus', 'x'], reportSpecs)).toThrow('Unknown option: --bogus')
  })

  test('rejects a missing or empty value flag', () => {
    expect(() => parseArgs(['--output'], reportSpecs)).toThrow('Missing value for --output')
    expect(() => parseArgs(['--output', ''], reportSpecs)).toThrow('Missing value for --output')
  })

  test('rejects flag-shaped values', () => {
    expect(() => parseArgs(['--output', '--weird'], reportSpecs)).toThrow(
      'Missing value for --output',
    )
  })

  test('rejects duplicate value flags', () => {
    expect(() =>
      parseArgs(['--input', 'a', '--input', 'b'], reportSpecs),
    ).toThrow('Duplicate option: --input')
  })
})

describe('requirePositionalCount', () => {
  test('returns positionals when the count matches', () => {
    const parsed = parseArgs(['change-001'], [{ name: 'input', takesValue: true }])
    expect(requirePositionalCount(parsed, 1)).toEqual(['change-001'])
  })

  test('rejects too few or too many positionals', () => {
    expect(() => requirePositionalCount(parseArgs([], []), 1)).toThrow(UsageError)
    expect(() => requirePositionalCount(parseArgs(['a', 'b'], []), 1)).toThrow(UsageError)
    expect(() => requirePositionalCount(parseArgs(['a'], []), 0)).toThrow(UsageError)
  })

  test('usage messages name the expected argument count', () => {
    expect(() => requirePositionalCount(parseArgs(['a'], []), 0)).toThrow(
      'Expected no arguments, received 1',
    )
    expect(() => requirePositionalCount(parseArgs(['a', 'b'], []), 1)).toThrow(
      'Expected exactly 1 argument, received 2',
    )
    expect(() => requirePositionalCount(parseArgs(['a'], []), 2)).toThrow(
      'Expected exactly 2 arguments, received 1',
    )
    expect(() => requirePositionalCount(parseArgs([], []), 1, 2)).toThrow(
      'Expected between 1 and 2 arguments, received 0',
    )
  })

  test('supports a positional range', () => {
    expect(requirePositionalCount(parseArgs([], []), 0, 1)).toEqual([])
  })
})
