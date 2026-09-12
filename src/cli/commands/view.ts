import { z } from 'zod'
import { materialize } from '../input'
import { loadReportClient, renderReport } from '../../report'
import { openBrowser, startReportPreview } from '../../report/view'

const viewOptionsSchema = z.object({
  input: z.string().optional(),
  explanations: z.string().optional(),
})

export async function viewReview(options: z.input<typeof viewOptionsSchema>): Promise<void> {
  const { input, explanations } = viewOptionsSchema.parse(options)
  const { document } = await materialize({ input, explanations })
  const clientBundle = await loadReportClient()
  const html = renderReport(document, clientBundle)
  const preview = await startReportPreview(html)
  console.log(`Viewing ${document.sections.length} sections at ${preview.url}
Press Ctrl+C to stop the local review.`)
  try {
    await openBrowser(preview.url)
  } catch (error) {
    console.log(`Could not open a browser automatically: ${(error as Error).message}
Open ${preview.url} yourself.`)
  }
}
