#!/usr/bin/env node

import { Command } from 'commander'
import { authoringOptionsSchema, captureOptionsSchema } from './authoring/input'
import { changeCommand } from './cli/commands/change'
import { changesCommand, changesOptionsSchema } from './cli/commands/changes'
import { checkCommand } from './cli/commands/check'
import { exportCommand, exportOptionsSchema } from './cli/commands/export'
import { fileCommand, fileOptionsSchema } from './cli/commands/file'
import { inspectCommand, inspectOptionsSchema } from './cli/commands/inspect'
import { publishCommand, publishOptionsSchema } from './cli/commands/publish'
import { unpublishCommand, unpublishOptionsSchema } from './cli/commands/unpublish'
import { viewCommand } from './cli/commands/view'
import { withArgument, withOptions } from './cli/options'
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
      return inspectCommand(
        positionals.revision,
        inspectOptionsSchema.parse(options),
        positionals.paths,
      )
    })

  cli
    .command('changes')
    .description('List captured change blocks')
    .option('--json', 'Print structured JSON change data')
    .option('--input <path>', 'Use an explicit capture path')
    .action(withOptions(changesOptionsSchema, changesCommand))

  cli
    .command('change <id>')
    .description('Read one captured change block')
    .option('--input <path>', 'Use an explicit capture path')
    .action(withArgument(captureOptionsSchema, changeCommand))

  cli
    .command('file <path>')
    .description('Read one captured file side')
    .option('--before', 'Print the captured old side')
    .option('--after', 'Print the captured new side')
    .option('--input <path>', 'Use an explicit capture path')
    .action(withArgument(fileOptionsSchema, fileCommand))

  cli
    .command('check')
    .description('Validate capture and explanations')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .action(withOptions(authoringOptionsSchema, checkCommand))

  cli
    .command('view')
    .description('Preview the review in a local browser')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .action(withOptions(authoringOptionsSchema, viewCommand))

  cli
    .command('export <format>')
    .description('Write an HTML review or ExplainDocument JSON')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .option('--output <path>', 'Write to an explicit output path')
    .action(withArgument(exportOptionsSchema, exportCommand))

  cli
    .command('publish')
    .description('Publish a hosted review, or replace its content with --update')
    .option('--input <path>', 'Use an explicit capture path')
    .option('--explanations <path>', 'Use an explicit explanations path')
    .option('--service <url>', 'Use an explicit review service origin')
    .option('--update', 'Replace the content behind the retained review link')
    .action(withOptions(publishOptionsSchema, publishCommand))

  cli
    .command('unpublish <id>')
    .description('Remove a published review')
    .option('--token <token>', 'Use the review revocation token')
    .option('--service <url>', 'Use an explicit review service origin')
    .action(withArgument(unpublishOptionsSchema, unpublishCommand))

  return cli
}

function inspectPositionals(command: Command): { revision: string | undefined; paths: string[] } {
  const operands = command.args
  const separator = process.argv.indexOf('--', 2)
  if (separator === -1) {
    if (operands.length > 1) {
      throw new UsageError('Pass at most one revision; separate paths from options with `--`')
    }
    return { revision: operands[0], paths: [] }
  }
  const paths = process.argv.slice(separator + 1)
  if (operands.length - paths.length > 1) {
    throw new UsageError('Pass at most one revision before `--`')
  }
  return { revision: operands.length > paths.length ? operands[0] : undefined, paths }
}

function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
