export interface FlagSpec {
  name: string
  takesValue: boolean
}

export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean | undefined>
  help: boolean
}

export function parseArgs(args: string[], specs: FlagSpec[]): ParsedArgs {
  const flags: Record<string, string | boolean | undefined> = {}
  const positionals: string[] = []
  let help = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const spec = specs.find((candidate) => candidate.name === name)
    if (!spec) throw new UsageError(`Unknown option: ${arg}`)
    if (spec.takesValue) {
      const value = args[++index]
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new UsageError(`Missing value for ${arg}`)
      }
      if (flags[name] !== undefined) throw new UsageError(`Duplicate option: ${arg}`)
      flags[name] = value
    } else {
      flags[name] = true
    }
  }

  return { positionals, flags, help }
}

export function requirePositionalCount(args: ParsedArgs, min: number, max = min): string[] {
  const count = args.positionals.length
  if (count < min || count > max) {
    const expected =
      min === max
        ? min === 0
          ? 'no arguments'
          : min === 1
            ? 'exactly 1 argument'
            : `exactly ${min} arguments`
        : `between ${min} and ${max} arguments`
    throw new UsageError(`Expected ${expected}, received ${count}`)
  }
  return args.positionals
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}
