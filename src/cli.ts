#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createExplainCapture, duplicatedChangeIds, materializeExplainDocument } from './authoring'
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
import { openBrowser, startReportPreview } from './view'
import { currentWalk, currentWalkIfPresent, setCurrentWalk, walkId, walkPaths } from './walk'

interface AuthoringFiles {
  directory: string
  capture: string
  explanations: string
  html: string
  json: string
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
  const capturedAt = new Date().toISOString()
  const git = await captureGitChanges(base)
  const capture = createExplainCapture(git.files, {
    kind: 'working-tree',
    from: { revision: base, commit: git.baseCommit },
    capturedAt,
  })
  const outputOverride = option(parsed, 'output')
  const explanationsOverride = option(parsed, 'explanations')

  if (outputOverride !== undefined || explanationsOverride !== undefined) {
    const paths = authoringFiles(outputOverride, explanationsOverride)
    await writeCapture(paths, capture)
    console.log(
      `Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}`,
    )
    console.log(
      `Next: edit ${paths.explanations}, then run \`diffwalk check --input ${paths.capture} --explanations ${paths.explanations}\`.`,
    )
    return
  }

  const previous = await currentWalkIfPresent()
  if (previous !== null) {
    const previousCapture = await readCapture(previous.capture)
    if (previousCapture.captureId === capture.captureId) {
      if (existsSync(previous.explanations)) {
        console.log(`Kept existing ${previous.explanations} (inspect never overwrites it)`)
      } else {
        await writeText(previous.explanations, explanationsSkeleton(capture.captureId))
        console.log(`Wrote a ${previous.explanations} skeleton to author`)
      }
      console.log(`Working tree is unchanged; kept current walk ${previous.id}`)
      console.log(`Next: edit ${previous.explanations}, then run \`diffwalk check\`.`)
      return
    }
  }

  const id = walkId(capturedAt, capture.captureId)
  const paths = walkPaths(id)
  if (existsSync(paths.capture)) {
    const existing = await readCapture(paths.capture)
    if (existing.captureId !== capture.captureId) {
      throw new Error(`Walk ID collision at ${paths.directory}`)
    }
  } else {
    await writeJson(paths.capture, capture)
  }

  if (existsSync(paths.explanations)) {
    console.log(`Kept existing ${paths.explanations} (inspect never overwrites it)`)
  } else {
    await writeText(paths.explanations, explanationsSkeleton(capture.captureId))
    console.log(`Wrote a ${paths.explanations} skeleton to author`)
  }
  await setCurrentWalk(id)
  console.log(
    `Captured ${capture.changes.length} change blocks across ${capture.files.length} files to ${paths.capture}`,
  )
  console.log(`Current walk: ${id}`)
  console.log(`Next: edit ${paths.explanations}, then run \`diffwalk check\`.`)
}

async function changesCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const capture = await readCapture(await captureInput(parsed))
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
  const capture = await readCapture(await captureInput(parsed))
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
  const capture = await readCapture(await captureInput(parsed))
  const file = capture.files.find((candidate) => candidate.path === path)
  if (!file) throw new Error(`Unknown file path: ${path}`)
  process.stdout.write(before ? file.oldContent : file.newContent)
}

async function checkCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const paths = await authoringInput(parsed)
  const capture = await readCapture(paths.capture)
  const explanations = await readExplanations(paths.explanations)
  const document = materializeExplainDocument(capture, explanations)
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  const steps = document.sections.reduce((total, section) => total + section.steps.length, 0)
  console.log(
    `OK: ${document.sections.length} sections and ${steps} steps cover ${capture.changes.length} of ${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`,
  )
  // Showing a change twice is a legitimate way to build an argument, so it is reported
  // rather than rejected. Only an unexplained change fails the check.
  const repeated = duplicatedChangeIds(explanations)
  if (repeated.length > 0) {
    console.log(`${repeated.length} changes are shown more than once: ${repeated.join(', ')}`)
  }
  console.log('Next: `diffwalk view`, `diffwalk export html`, or `diffwalk publish`.')
}

async function viewCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const { document } = await materialize(parsed)
  const clientBundle = await loadReportClient()
  const html = renderReport(document, clientBundle)
  const preview = await startReportPreview(html)
  console.log(`Viewing ${document.sections.length} sections at ${preview.url}`)
  console.log('Press Ctrl+C to stop the local report.')
  try {
    await openBrowser(preview.url)
  } catch (error) {
    console.log(`Could not open a browser automatically: ${(error as Error).message}`)
    console.log(`Open ${preview.url} yourself.`)
  }
}

async function exportCommand(parsed: ParsedArgs) {
  const [format] = requirePositionalCount(parsed, 1)
  if (format !== 'html' && format !== 'json') {
    throw new UsageError(`Unknown export format: ${format}`)
  }
  const { document, paths } = await materialize(parsed)
  if (format === 'html') {
    const output = option(parsed, 'output') ?? paths.html
    const clientBundle = await loadReportClient()
    const html = renderReport(document, clientBundle)
    await writeReport(output, html)
    console.log(
      `Wrote a ${html.length} byte report for ${document.sections.length} sections to ${output}`,
    )
    return
  }
  const output = option(parsed, 'output') ?? paths.json
  await writeJson(output, document)
  console.log(`Wrote ${document.sections.length} explanation sections to ${output}`)
}

async function publishCommand(parsed: ParsedArgs) {
  requirePositionalCount(parsed, 0)
  const { document } = await materialize(parsed)
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

async function materialize(
  parsed: ParsedArgs,
): Promise<{ document: ExplainDocument; paths: AuthoringFiles }> {
  const paths = await authoringInput(parsed)
  const capture = await readCapture(paths.capture)
  const explanations = await readExplanations(paths.explanations)
  return { document: materializeExplainDocument(capture, explanations), paths }
}

async function captureInput(parsed: ParsedArgs): Promise<string> {
  return option(parsed, 'input') ?? (await currentWalk()).capture
}

async function authoringInput(parsed: ParsedArgs): Promise<AuthoringFiles> {
  const capture = option(parsed, 'input')
  const explanations = option(parsed, 'explanations')
  if (capture === undefined && explanations === undefined) return currentWalk()
  return authoringFiles(capture, explanations)
}

function authoringFiles(
  capture: string | undefined,
  explanations: string | undefined,
): AuthoringFiles {
  const directory = dirname(capture ?? explanations!)
  return {
    directory,
    capture: capture ?? join(directory, 'capture.json'),
    explanations: explanations ?? join(directory, 'explanations.yaml'),
    html: join(directory, 'diffwalk.html'),
    json: join(directory, 'diffwalk.json'),
  }
}

async function writeCapture(paths: AuthoringFiles, capture: ExplainCapture): Promise<void> {
  await writeJson(paths.capture, capture)
  if (existsSync(paths.explanations)) {
    console.log(`Kept existing ${paths.explanations} (inspect never overwrites it)`)
  } else {
    await writeText(paths.explanations, explanationsSkeleton(capture.captureId))
    console.log(`Wrote a ${paths.explanations} skeleton to author`)
  }
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

function explanationsSkeleton(captureId: string): string {
  return `captureId: ${captureId}
title: Name this change set
summary: |
  Optional. Markdown, and inline HTML is allowed, so an <svg> diagram can open the report.
sections: []
`
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
