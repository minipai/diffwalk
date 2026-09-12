import { z } from 'zod'
import type { ExplainDocument } from '../../format/types'
import { materialize, writeJson } from '../input'
import { loadReportClient, renderReport, writeReport } from '../../report'
import { UsageError } from '../usage'

const exportOptionsSchema = z.object({
  input: z.string().optional(),
  explanations: z.string().optional(),
  output: z.string().optional(),
})

export async function exportReview(format: string, options: z.input<typeof exportOptionsSchema>): Promise<void> {
  const { input, explanations, output } = exportOptionsSchema.parse(options)
  validateExportFormat(format)
  const { document, paths } = await materialize({ input, explanations })
  switch (format) {
    case 'html':
      await exportHtml(document, output ?? paths.html)
      break
    case 'json':
      await exportJson(document, output ?? paths.json)
      break
  }
}

function validateExportFormat(format: string): asserts format is 'html' | 'json' {
  if (format !== 'html' && format !== 'json') {
    throw new UsageError(`Unknown export format: ${format}`)
  }
}

async function exportHtml(document: ExplainDocument, output: string): Promise<void> {
  const clientBundle = await loadReportClient()
  const html = renderReport(document, clientBundle)
  await writeReport(output, html)
  console.log(
    `Wrote a ${html.length} byte review for ${document.sections.length} sections to ${output}`,
  )
}

async function exportJson(document: ExplainDocument, output: string): Promise<void> {
  await writeJson(output, document)
  console.log(`Wrote ${document.sections.length} explanation sections to ${output}`)
}
