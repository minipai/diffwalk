import { z } from 'zod'
import { authoringOptionsSchema, materialize } from '../../authoring/input'
import { publishDocument, reportService } from '../../publish'

export const publishOptionsSchema = authoringOptionsSchema.extend({
  service: z.string().optional(),
})
type PublishOptions = z.infer<typeof publishOptionsSchema>

export async function publishCommand(options: PublishOptions): Promise<void> {
  const { document } = await materialize(options)
  const service = reportService(options.service)
  const published = await publishDocument(document, service)
  console.log(`Published ${document.sections.length} explanation sections to ${published.url}`)
  console.log(`Revocation token: ${published.revocationToken}`)
  console.log(
    `Store that token now; it is shown once. Remove the review with \`diffwalk unpublish ${published.id} --token ${published.revocationToken}\`.`,
  )
}
