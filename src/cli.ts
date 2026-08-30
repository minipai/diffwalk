#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createExplainCapture, materializeExplainDocument } from './authoring'
import { parseArgs, requirePositionalCount, UsageError, type ParsedArgs, type FlagSpec } from './cli-args'
import { parseExplanations } from './explanations'
import {
  captureSchema,
  type ExplainCapture,
  type ExplainDocument,
  type Explanations,
} from './format'
import { captureGitChanges } from './git'
import { commandHelp, isCommandName, topLevelHelp, type CommandName } from './help'
import { publishDocument, reportService, unpublishDocument } from './publish'
import { loadReportClient, renderReport, writeReport } from './report'

const defaults = {
  capture: '.explain/capture.json',
  explanations: '.explain/explanations.yaml',
  document: '.explain/document.json',
  report: '.explain/report.html',
}

const flagSpecs: Record<CommandName, FlagSpec[]> = {
  inspect: [
    { name: 'base', takesValue: true },
    { name: 'output', takesValue: true },
    { name: 'explanations', takesValue: true },
  ],
  changes: [
    { name: 'json', takesValue: false },
    { name: 'input', takesValue: true },
  ],
  change: [{ name: 'input', takesValue: true }],
  file: [
    { name: 'before', takesValue: false },
    { name: 'after', takesValue: false },
    { name: 'input', takesValue: true },
  ],
  check: [
    { name: 'input', takesValue: true },
    { name: 'explanations', takesValue: true },
  ],
  view: [
    { name: 'input', takesValue: true },
    { name: 'explanations', takesValue: true },
  ],
  report: [
    { name: 'input', takesValue: true },
    { name: 'explanations', takesValue: true },
    { name: 'output', takesValue: true },
  ],
  export: [
    { name: 'input', takesValue: true },
    { name: 'explanations', takesValue: true },
    { name: 'output', takesValue: true },
  ],
  publish: [
    { name: 'input', takesValue: true },
    { name: 'explanations', takesValue: true },
    { name: 'service', takesValue: true },
  ],
  unpublish: [
    { name: 'token', takesValue: true },
    { name: 'service', takesValue: true },
  ],
  help: [],
}

let attempted: CommandName | null = null

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === undefined || command === '--help' || command === '-h') {
    console.log(topLevelHelp())
    return
  }

  if (command === 'help') {
    attempted = 'help'
    const parsed = parseArgs(args, [])
    const [topic] = parsed.positionals
    if (topic !== undefined && !isCommandName(topic)) {
      throw new UsageError(`Unknown command: ${topic}`)
    }
    requirePositionalCount(parsed, 0, 1)
    if (parsed.help) {
      console.log(topic === undefined ? topLevelHelp() : commandHelp(topic))
    } else if (topic === undefined) {
      console.log(topLevelHelp())
    } else {
      console.log(commandHelp(topic))
    }
    return
  }

  if (!isCommandName(command)) throw new UsageError(`Unknown command: ${command}`)
  attempted = command

  const parsed = parseArgs(args, flagSpecs[command])
  if (parsed.help) {
    console.log(commandHelp(command))
    return
  }

  switch (command) {
    case 'inspect':
      await inspectCommand(parsed)
      break
    case 'changes':
      await changesCommand(parsed)
      break
    case 'change':
      await changeCommand(parsed)
      break
    case 'file':
      await fileCommand(parsed)
      break
    case 'check':
      await checkCommand(parsed)
      break
    case 'view':
      await viewCommand(parsed)
      break
    case 'report':
      await reportCommand(parsed)
      break
    case 'export':
      await exportCommand(parsed)
      break
    case 'publish':
      await publishCommand(parsed)
      break
    case 'unpublish':
      await unpublishCommand(parsed)
      break
  }
}

async function inspectCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const base = option(parsed, 'base') ?? 'HEAD'
  const capturePath = option(parsed, 'output') ?? defaults.capture
  const explanationsPath = option(parsed, 'explanations') ?? defaults.explanations

  const git = await captureGitChanges(base)
  const capture = createExplainCapture(git.files, {
    kind: 'working-tree',
    from: { revision: base, commit: git.baseCommit },
    capturedAt: new Date().toISOString(),
  })
  await writeJson(capturePath, capture)

  if (existsSync(explanationsPath)) {
    console.log(`Kept existing ${explanationsPath} (inspect never overwrites it)`)
  } else {
    await writeText(
      explanationsPath,
      `captureId: ${capture.captureId}\nsections: []\n`,
    )
    console.log(`Wrote a ${explanationsPath} skeleton to author`)
  }

  console.log(
    `Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${capturePath}`,
  )
  const checkSuffix = [
    capturePath !== defaults.capture ? `--input ${capturePath}` : '',
    explanationsPath !== defaults.explanations ? `--explanations ${explanationsPath}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  console.log(
    `Next: edit ${explanationsPath}, then run \`diffwalk check${checkSuffix ? ` ${checkSuffix}` : ''}\`.`,
  )
}

async function changesCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const capture = await readCapture(option(parsed, 'input') ?? defaults.capture)
  if (parsed.flags.json === true) {
    console.log(
      JSON.stringify(
        { captureId: capture.captureId, changes: capture.changes },
        null,
        2,
      ),
    )
    return
  }
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  console.log(
    `${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`,
  )
  for (const change of capture.changes) console.log(changeLine(change))
}

async function changeCommand(parsed: ParsedArgs) {
  const [id] = requirePositionalCount(parsed, 1)
  const capture = await readCapture(option(parsed, 'input') ?? defaults.capture)
  const change = capture.changes.find((candidate) => candidate.id === id)
  if (!change) throw new Error(`Unknown change ID: ${id}`)
  console.log(`${change.id}  ${change.path}  ${coordinates(change)}`)
  console.log('before:')
  process.stdout.write(change.before)
  if (!change.before.endsWith('\n')) console.log()
  console.log('after:')
  process.stdout.write(change.after)
  if (!change.after.endsWith('\n')) console.log()
}

async function fileCommand(parsed: ParsedArgs) {
  const [path] = requirePositionalCount(parsed, 1)
  const before = parsed.flags.before === true
  const after = parsed.flags.after === true
  if (before === after) {
    throw new UsageError('Choose exactly one side with --before or --after')
  }
  const capture = await readCapture(option(parsed, 'input') ?? defaults.capture)
  const file = capture.files.find((candidate) => candidate.path === path)
  if (!file) throw new Error(`Unknown file path: ${path}`)
  process.stdout.write(before ? file.oldContent : file.newContent)
}

async function checkCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const capture = await readCapture(option(parsed, 'input') ?? defaults.capture)
  const explanations = await readExplanations(
    option(parsed, 'explanations') ?? defaults.explanations,
  )
  const document = materializeExplainDocument(capture, explanations)
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  console.log(
    `OK: ${document.sections.length} sections cover ${capture.changes.length} of ${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`,
  )
  console.log('Next: `diffwalk view`, `diffwalk export`, or `diffwalk report`.')
}

async function viewCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const document = await materialize(parsed)
  const { viewDocument } = await import('./main')
  await viewDocument(document)
}

async function reportCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const document = await materialize(parsed)
  const output = option(parsed, 'output') ?? defaults.report
  const clientBundle = await loadReportClient()
  const html = renderReport(document, clientBundle)
  await writeReport(output, html)
  console.log(
    `Wrote a ${html.length} byte report for ${document.sections.length} sections to ${output}`,
  )
}

async function exportCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const document = await materialize(parsed)
  const output = option(parsed, 'output') ?? defaults.document
  await writeJson(output, document)
  console.log(`Wrote ${document.sections.length} explanation sections to ${output}`)
}

async function publishCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const document = await materialize(parsed)
  const service = reportService(option(parsed, 'service'))
  const published = await publishDocument(document, service)
  console.log(
    `Published ${document.sections.length} explanation sections to ${published.url}`,
  )
  console.log(`Revocation token: ${published.revocationToken}`)
  console.log(
    `Store that token now; it is shown once. Remove the report with \`diffwalk unpublish ${published.id} --token ${published.revocationToken}\`.`,
  )
}

async function unpublishCommand(parsed: ParsedArgs) {
  const [id] = requirePositionalCount(parsed, 1)
  const token = option(parsed, 'token')
  if (token === undefined) {
    throw new UsageError('Pass the report\'s revocation token with --token')
  }
  const service = reportService(option(parsed, 'service'))
  await unpublishDocument(id!, service, token)
  console.log(`Removed report ${id} from ${service}`)
}

async function materialize(parsed: ParsedArgs): Promise<ExplainDocument> {
  const capture = await readCapture(option(parsed, 'input') ?? defaults.capture)
  const explanations = await readExplanations(
    option(parsed, 'explanations') ?? defaults.explanations,
  )
  return materializeExplainDocument(capture, explanations)
}

async function readCapture(path: string): Promise<ExplainCapture> {
  return captureSchema.parse(JSON.parse(await readInput(path, 'capture.json', true)))
}

async function readExplanations(path: string): Promise<Explanations> {
  const text = await readInput(path, 'explanations.yaml', false)
  try {
    return parseExplanations(text)
  } catch (error) {
    throw new Error(`${(error as Error).message} (in ${path})`)
  }
}

async function readInput(
  path: string,
  label: string,
  isCapture: boolean,
): Promise<string> {
  const absolutePath = resolve(path)
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const hint = isCapture
        ? `No capture at ${path}. Run \`diffwalk inspect\` first, or pass --input.`
        : `No explanations at ${path}. Run \`diffwalk inspect\` first, or pass --explanations.`
      throw new Error(hint)
    }
    throw new Error(`Could not read ${label}: ${(error as Error).message}`)
  }
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name]
  return typeof value === 'string' ? value : undefined
}

function coordinates(change: { oldStart: number; oldCount: number; newStart: number; newCount: number }) {
  return `old ${change.oldStart}:${change.oldCount} → new ${change.newStart}:${change.newCount} (+${change.newCount} −${change.oldCount})`
}

function changeLine(change: {
  id: string
  path: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}) {
  return `${change.id}  ${change.path}  ${coordinates(change)}`
}

function shortId(captureId: string): string {
  return captureId.length > 12 ? captureId.slice(0, 12) : captureId
}

async function writeJson(path: string, value: unknown) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path: string, text: string) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, text)
}

await main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(error.message)
    if (attempted !== null) console.error(commandHelp(attempted))
    else console.error(topLevelHelp())
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exitCode = 1
})
