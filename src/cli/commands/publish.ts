import { z } from 'zod'
import { gitUserName } from '../../authoring/git'
import { authoringOptionsSchema, materialize } from '../../authoring/input'
import { readPublishedReview, writePublishedReview } from '../../authoring/published'
import { publishDocument, reportService, updateDocument, withPublisher } from '../../publish'
import type { ExplainDocument } from '../../format'
import { UsageError } from '../usage'

export const publishOptionsSchema = authoringOptionsSchema.extend({
  service: z.string().optional(),
  update: z.boolean().optional(),
})
type PublishOptions = z.infer<typeof publishOptionsSchema>

export async function publishCommand(options: PublishOptions): Promise<void> {
  const { document, paths } = await materialize(options)
  const outgoing = withPublisher(document, await gitUserName())
  if (options.update === true) {
    await updatePublishedReview(outgoing, paths.published, options.service)
    return
  }

  const service = reportService(options.service)
  const published = await publishDocument(outgoing, service)
  // The token is shown before the retention write so a failed write can never leave a
  // live review whose only credential was never surfaced.
  console.log(`Published ${outgoing.sections.length} explanation sections to ${published.url}`)
  console.log(`Revocation token: ${published.revocationToken}`)
  await writePublishedReview(paths.published, {
    id: published.id,
    url: published.url,
    service,
    revocationToken: published.revocationToken,
  })
  console.log(
    `Retained at ${paths.published} (keep it out of version control). Remove the review with \`diffwalk unpublish ${published.id} --token ${published.revocationToken}\`, or replace its content later with \`diffwalk publish --update\`.`,
  )
}

async function updatePublishedReview(
  document: ExplainDocument,
  path: string,
  serviceOption: string | undefined,
): Promise<void> {
  const retained = await readPublishedReview(path)
  if (retained === null) {
    throw new UsageError(
      'No published review is retained for this walk. Run `diffwalk publish` first.',
    )
  }

  // Validate the stored service too, so a damaged retained file can never aim the
  // revocation token at an arbitrary or plaintext host.
  const service = reportService(serviceOption ?? retained.service)
  if (service !== retained.service) {
    throw new UsageError(
      `The retained review is hosted at ${retained.service}; update it there by passing only --update.`,
    )
  }

  await updateDocument(document, retained.id, service, retained.revocationToken)
  console.log(`Updated ${document.sections.length} explanation sections at ${retained.url}`)
  console.log(`Review ${retained.id} keeps its link and revocation token.`)
}
