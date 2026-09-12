import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

export { renderHostedReport, renderReport, shellStyles } from './render'
export type { HostedAssets, ReportLayout, ReportOptions } from './render'

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
  // Source runs from src/report; the bundled CLI runs beside report-client.js.
  const prebuilt = new URL(
    import.meta.url.endsWith('.ts') ? '../../dist/report-client.js' : './report-client.js',
    import.meta.url,
  )
  try {
    return await readFile(prebuilt, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('The report client bundle is missing. Reinstall Diffwalk and try again.')
    }
    throw error
  }
}
