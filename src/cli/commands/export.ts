import { z } from 'zod'
import { authoringOptionsSchema, materialize, writeJson } from '../../authoring/input'
import { loadReportClient, renderReport, writeReport } from '../../report'
import { UsageError } from '../usage'

export const exportOptionsSchema = authoringOptionsSchema.extend({
  output: z.string().optional(),
})
type ExportOptions = z.infer<typeof exportOptionsSchema>

export async function exportCommand(format: string, options: ExportOptions): Promise<void> {
  if (format !== 'html' && format !== 'json') {
    throw new UsageError(`Unknown export format: ${format}`)
  }
  const { document, paths } = await materialize(options)
  if (format === 'html') {
    const output = options.output ?? paths.html
    const clientBundle = await loadReportClient()
    const html = renderReport(document, clientBundle)
    await writeReport(output, html)
    console.log(
      `Wrote a ${html.length} byte review for ${document.sections.length} sections to ${output}`,
    )
    return
  }
  const output = options.output ?? paths.json
  await writeJson(output, document)
  console.log(`Wrote ${document.sections.length} explanation sections to ${output}`)
}
