#!/usr/bin/env node

import { Command } from 'commander'
import { printChange } from './cli/commands/change'
import { printChanges } from './cli/commands/changes'
import { checkReview } from './cli/commands/check'
import { removeWalk } from './cli/commands/delete'
import { exportReview } from './cli/commands/export'
import { printFile } from './cli/commands/file'
import { inspectChanges } from './cli/commands/inspect'
import { publishReview } from './cli/commands/publish'
import { removeReview } from './cli/commands/unpublish'
import { selectWalk } from './cli/commands/use'
import { viewReview } from './cli/commands/view'
import { printWalks } from './cli/commands/walks'
import { UsageError } from './cli/usage'
import packageJson from '../package.json'

await main()

async function main(): Promise<void> {
  const cli = createCli()
  try {
    await cli.parseAsync(process.argv)
  } catch (error) {
    reportError(error)
  }
}

function createCli(): Command {
  const cli = new Command()
    .name('diffwalk')
    .description(packageJson.description)
    .version(packageJson.version, '-v, --version')
    .action(() => cli.outputHelp())

  cli
    .command('inspect [revision]')
    .description('Capture working-tree changes or committed revisions')
    .option('--staged', 'Capture only changes staged in the index')
    .option('--base <revision>', 'Git base to diff against')
    .option('--from <revision>', 'Committed revision range start')
    .option('--to <revision>', 'Committed revision range end')
    .option('--path <path>', 'Limit a working-tree capture to a literal file or directory; repeatable, not with --pathspec', collectOption, [])
    .option('--pathspec <expression>', 'Limit a working-tree capture with a Git pathspec expression; repeatable, not with --path', collectOption, [])
    .option('--exclude <path>', 'Exclude a literal file or directory; repeatable', collectOption, [])
    .option('--output <path>', 'Write capture to an explicit path')
    .option('--explanations <path>', 'Write or preserve authoring YAML at an explicit path')
    .allowExcessArguments(true)
    .addHelpText('after', '\nLimit a working-tree capture with repeatable `--path <path>` for literal paths or repeatable `--pathspec <expression>` for Git pathspecs; the two are mutually exclusive. Quote pathspec expressions so the shell does not expand them:\n  diffwalk inspect --pathspec \':(glob)src/**/*.ts\'\n  diffwalk inspect --pathspec \':(exclude)pnpm-lock.yaml\'\nRepeatable `--exclude <path>` drops literal paths after Git scope selection and composes with either mode. An exclusion always wins over an included path; a rename crossing an exclusion keeps both paths and omits the excluded side.')
    .action((_revision: string | undefined, options: Record<string, unknown>, command: Command) =>
      inspectChanges(inspectRevision(command), options),
    )

  cli
    .command('walks')
    .description('List timestamped walks and mark the current one')
    .action(() => printWalks())

  cli
    .command('use <walk-id>')
    .description('Select a local walk as current')
    .action(selectWalk)

  cli
    .command('delete <walk-id>')
    .description('Delete a local walk')
    .action(removeWalk)

  cli
    .command('changes')
    .description('List captured change blocks')
    .option('--json', 'Print structured JSON change data')
    .option('--input <path>', 'Use an explicit capture path')
    .action(printChanges)

  cli
    .command('change <id>')
    .description('Read one captured change block')
    .option('--input <path>', 'Use an explicit capture path')
    .action(printChange)

  cli
    .command('file <path>')
    .description('Read one captured file side')
    .option('--before', 'Print the captured old side')
    .option('--after', 'Print the captured new side')
    .option('--input <path>', 'Use an explicit capture path')
    .action(printFile)

  cli
    .command('check')
    .description('Validate capture and explanations')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .action(checkReview)

  cli
    .command('view')
    .description('Preview the review in a local browser')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .action(viewReview)

  cli
    .command('export <format>')
    .description('Write an HTML review or ExplainDocument JSON')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .option('--output <path>', 'Write to an explicit output path')
    .action(exportReview)

  cli
    .command('publish')
    .description('Publish a hosted review, or replace its content with --update')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .option('--service <url>', 'Use an explicit review service origin')
    .option('--update', 'Replace the content behind the retained review link')
    .action(publishReview)

  cli
    .command('unpublish <id>')
    .description('Remove a published review')
    .option('--token <token>', 'Use the review revocation token')
    .option('--service <url>', 'Use an explicit review service origin')
    .action(removeReview)

  return cli
}

function inspectRevision(command: Command): string | undefined {
  if (hasPathSeparator(process.argv)) {
    throw new UsageError(
      'Path selection no longer uses `-- <path>...`; use repeatable `--path <path>` for literal paths or `--pathspec <expression>` for Git pathspecs',
    )
  }
  if (command.args.length > 1) {
    throw new UsageError('Pass at most one revision; select changes with `--path` or `--pathspec`')
  }
  return command.args[0]
}

// The old `-- <path>...` selection is gone. Commander consumes a `--` that follows a
// value-taking option as that option's value, so only a bare `--` that is not a value is
// the removed path separator.
function hasPathSeparator(argv: string[]): boolean {
  const valueOptions = new Set([
    '--base',
    '--from',
    '--to',
    '--path',
    '--pathspec',
    '--exclude',
    '--output',
    '--explanations',
  ])
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index]!
    if (token === '--') return true
    if (valueOptions.has(token)) index++
  }
  return false
}

function collectOption(value: string, values: string[]): string[] {
  return [...values, value]
}

function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
