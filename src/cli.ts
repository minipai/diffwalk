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
    .option('--output <path>', 'Write capture to an explicit path')
    .option('--explanations <path>', 'Write or preserve authoring YAML at an explicit path')
    .allowExcessArguments(true)
    .addHelpText('after', '\nLimit a working-tree capture with --staged or a `-- <path>...` list.')
    .action((_revision: string | undefined, options: Record<string, unknown>, command: Command) => {
      const positionals = inspectPositionals(command)
      return inspectChanges(
        positionals.revision,
        options,
        positionals.paths,
      )
    })

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

function inspectPositionals(command: Command): { revision: string | undefined; paths: string[] } {
  const operands = command.args
  const separator = process.argv.indexOf('--', 2)
  if (separator === -1) {
    validateRevisionCount(operands.length, false)
    return { revision: operands[0], paths: [] }
  }
  const paths = process.argv.slice(separator + 1)
  validateRevisionCount(operands.length - paths.length, true)
  return { revision: operands.length > paths.length ? operands[0] : undefined, paths }
}

function validateRevisionCount(count: number, hasPathSeparator: boolean): void {
  if (count > 1) {
    throw new UsageError(hasPathSeparator
      ? 'Pass at most one revision before `--`'
      : 'Pass at most one revision; separate paths from options with `--`')
  }
}

function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
