#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildExplainDocument, createExplainDraft } from './authoring'
import { parseReportArgs } from './cli-args'
import { captureGitChanges } from './git'
import { explainDocumentSchema } from './format'
import { loadReportClient, renderReport, writeReport } from './report'

const defaults = {
  draft: '.explain/draft.json',
  document: '.explain/document.json',
}

const usage = `Usage:
  diffwalk inspect [--base HEAD] [--output .explain/draft.json]
  diffwalk build [--input .explain/draft.json] [--output .explain/document.json]
  diffwalk report <document.json> [--output report.html]
  diffwalk view <document.json>`

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'inspect') {
    const options = parseOptions(args, { base: 'HEAD', output: defaults.draft })
    const capture = await captureGitChanges(options.base)
    const draft = createExplainDraft(capture.files, {
      kind: 'working-tree',
      from: { revision: options.base, commit: capture.baseCommit },
      capturedAt: new Date().toISOString(),
    })
    await writeJson(options.output, draft)
    console.log(
      `Wrote ${draft.changes.length} change blocks from ${draft.files.length} files to ${options.output}`,
    )
    return
  }

  if (command === 'build') {
    const options = parseOptions(args, { input: defaults.draft, output: defaults.document })
    const input: unknown = JSON.parse(await readFile(resolve(options.input), 'utf8'))
    const document = buildExplainDocument(input)
    await writeJson(options.output, document)
    console.log(`Wrote ${document.sections.length} explanation sections to ${options.output}`)
    return
  }

  if (command === 'view' && args.length === 1) {
    const { viewDocument } = await import('./main')
    await viewDocument(args[0]!)
    return
  }

  if (command === 'report') {
    const options = parseReportArgs(args)
    const input: unknown = JSON.parse(await readFile(resolve(options.document), 'utf8'))
    const document = explainDocumentSchema.parse(input)
    const clientBundle = await loadReportClient()
    const html = renderReport(document, clientBundle)
    await writeReport(options.output, html)
    console.log(
      `Wrote a ${html.length} byte report for ${document.sections.length} sections to ${options.output}`,
    )
    return
  }

  throw new Error(usage)
}

function parseOptions<T extends Record<string, string>>(args: string[], defaults: T): T {
  const options = { ...defaults }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value, received: ${args.slice(index).join(' ')}`)
    }
    const name = flag.slice(2)
    if (!(name in options)) throw new Error(`Unknown option: ${flag}`)
    options[name as keyof T] = value as T[keyof T]
  }
  return options
}

async function writeJson(path: string, value: unknown) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
