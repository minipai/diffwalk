export interface ReportArgs {
  document: string
  output: string
}

export function parseReportArgs(args: string[]): ReportArgs {
  const positionals: string[] = []
  let output: string | null = null
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--output') {
      if (output !== null) throw new Error('Duplicate option: --output')
      const value = args[++index]
      if (value === undefined) throw new Error('Missing value for --output')
      if (value === '' || value.startsWith('-')) {
        throw new Error(`Invalid value for --output: ${value}`)
      }
      output = value
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }
  if (positionals.length !== 1) {
    throw new Error('Expected: diffwalk report <document.json> [--output report.html]')
  }
  return {
    document: positionals[0]!,
    output: output ?? defaultReportOutput(positionals[0]!),
  }
}

export function defaultReportOutput(document: string): string {
  return document.endsWith('.json')
    ? document.slice(0, -'.json'.length) + '.html'
    : `${document}.html`
}