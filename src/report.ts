import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

export { renderReport, shellStyles } from './report-shell'
export type { ReportLayout, ReportOptions } from './report-shell'

export async function writeReport(output: string, html: string): Promise<void> {
  const absolutePath = resolve(output)
  await mkdir(dirname(absolutePath), { recursive: true })
  const tempPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(tempPath, html)
    await rename(tempPath, absolutePath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

let reportClientPromise: Promise<string> | null = null

export function loadReportClient(): Promise<string> {
  reportClientPromise ??= loadReportClientUncached()
  return reportClientPromise
}

async function loadReportClientUncached(): Promise<string> {
  const root = resolve(import.meta.dir, '..')
  const prebuilt = join(root, 'dist', 'report-client.js')
  if (existsSync(prebuilt)) return readFile(prebuilt, 'utf8')
  const entry = join(root, 'src', 'report-client.ts')
  if (!existsSync(entry)) {
    throw new Error(
      'The report client bundle is missing. Rebuild the CLI with `pnpm build` and try again.',
    )
  }
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: true,
  })
  const output = result.outputs[0]
  if (!output) throw new Error('Report client bundle produced no output')
  return output.text()
}
