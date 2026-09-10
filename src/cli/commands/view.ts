import { materialize, type AuthoringOptions } from '../../authoring/input'
import { loadReportClient, renderReport } from '../../report'
import { openBrowser, startReportPreview } from '../../report/view'

export async function viewCommand(options: AuthoringOptions): Promise<void> {
  const { document } = await materialize(options)
  const clientBundle = await loadReportClient()
  const html = renderReport(document, clientBundle)
  const preview = await startReportPreview(html)
  console.log(`Viewing ${document.sections.length} sections at ${preview.url}`)
  console.log('Press Ctrl+C to stop the local review.')
  try {
    await openBrowser(preview.url)
  } catch (error) {
    console.log(`Could not open a browser automatically: ${(error as Error).message}`)
    console.log(`Open ${preview.url} yourself.`)
  }
}
