import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { materializeExplainDocument } from '../authoring/capture'
import { parseExplanations } from './explanations'
import { captureSchema } from '../format/schema'
import type { ExplainCapture, ExplainDocument, Explanations } from '../format/types'
import { currentWalk } from '../authoring/walk'

export interface CaptureOptions {
  input?: string
}

export interface AuthoringOptions extends CaptureOptions {
  explanations?: string
}

export interface AuthoringFiles {
  directory: string
  capture: string
  explanations: string
  html: string
  json: string
  published: string
}

export interface MaterializedAuthoring {
  capture: ExplainCapture
  explanations: Explanations
  document: ExplainDocument
  paths: AuthoringFiles
}

export async function materialize(options: AuthoringOptions): Promise<MaterializedAuthoring> {
  const paths = await authoringInput(options)
  const capture = await readCapture(paths.capture)
  const explanations = await readExplanations(paths.explanations)
  return {
    capture,
    explanations,
    document: materializeExplainDocument(capture, explanations),
    paths,
  }
}

export async function captureInput(options: CaptureOptions): Promise<string> {
  return options.input ?? (await currentWalk()).capture
}

export async function authoringInput(options: AuthoringOptions): Promise<AuthoringFiles> {
  const { input: capture, explanations } = options
  if (capture === undefined && explanations === undefined) return currentWalk()
  return authoringFiles(capture, explanations)
}

export function authoringFiles(
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
    published: join(directory, 'published.json'),
  }
}

export async function writeCapture(paths: AuthoringFiles, capture: ExplainCapture): Promise<void> {
  await writeJson(paths.capture, capture)
  if (existsSync(paths.explanations)) {
    console.log(`Kept existing ${paths.explanations} (inspect never overwrites it)`)
  } else {
    await writeText(paths.explanations, explanationsSkeleton(capture.captureId))
    console.log(`Wrote a ${paths.explanations} skeleton to author`)
  }
}

export async function readCapture(path: string): Promise<ExplainCapture> {
  return captureSchema.parse(JSON.parse(await readInput(path, 'capture.json', true)))
}

export function explanationsSkeleton(captureId: string): string {
  return `captureId: ${captureId}
title: Name this change set
summary: |
  Optional. Markdown, and inline HTML is allowed, so an <svg> diagram can open the review.
sections: []
`
}

export function shortId(captureId: string): string {
  return captureId.length > 12 ? captureId.slice(0, 12) : captureId
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeText(path: string, text: string): Promise<void> {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, text)
}

async function readExplanations(path: string): Promise<Explanations> {
  const text = await readInput(path, 'explanations.yaml', false)
  try {
    return parseExplanations(text)
  } catch (error) {
    throw new Error(`${(error as Error).message} (in ${path})`)
  }
}

async function readInput(path: string, label: string, isCapture: boolean): Promise<string> {
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
