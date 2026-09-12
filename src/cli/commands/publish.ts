import { z } from 'zod'
import { gitUserName } from '../../authoring/git'
import { materialize } from '../input'
import { readPublishedReview, writePublishedReview, type PublishedReview } from '../published'
import { publishDocument, updateDocument, withPublisher } from '../../publish/client'
import type { ExplainDocument } from '../../format/types'
import { reportService } from '../service'
import { UsageError } from '../usage'

const publishOptionsSchema = z.object({
  input: z.string().optional(),
  explanations: z.string().optional(),
  service: z.string().optional(),
  update: z.boolean().default(false),
})

export async function publishReview(options: z.input<typeof publishOptionsSchema>): Promise<void> {
  const { input, explanations, service, update } = publishOptionsSchema.parse(options)
  const { document, paths } = await materialize({ input, explanations })
  const outgoing = withPublisher(document, await gitUserName())
  switch (update) {
    case true:
      await updatePublishedReview(outgoing, paths.published, service)
      break
    case false:
      await createPublishedReview(outgoing, paths.published, service)
      break
  }
}

async function createPublishedReview(
  document: ExplainDocument,
  path: string,
  serviceOption: string | undefined,
): Promise<void> {
  const service = reportService(serviceOption)
  const published = await publishDocument(document, service)
  // The token is shown before the retention write so a failed write can never leave a
  // live review whose only credential was never surfaced.
  console.log(`Published ${document.sections.length} explanation sections to ${published.url}
Revocation token: ${published.revocationToken}`)
  await writePublishedReview(path, {
    id: published.id,
    url: published.url,
    service,
    revocationToken: published.revocationToken,
  })
  console.log(
    `Retained at ${path} (keep it out of version control). Remove the review with \`diffwalk unpublish ${published.id} --token ${published.revocationToken}\`, or replace its content later with \`diffwalk publish --update\`.`,
  )
}

async function updatePublishedReview(
  document: ExplainDocument,
  path: string,
  serviceOption: string | undefined,
): Promise<void> {
  const retained = await readPublishedReview(path)
  validateRetainedReview(retained)

  // Validate the stored service too, so a damaged retained file can never aim the
  // revocation token at an arbitrary or plaintext host.
  const service = reportService(serviceOption ?? retained.service)
  validateUpdateService(service, retained.service)

  await updateDocument(document, retained.id, service, retained.revocationToken)
  console.log(`Updated ${document.sections.length} explanation sections at ${retained.url}
Review ${retained.id} keeps its link and revocation token.`)
}

function validateRetainedReview(retained: PublishedReview | null): asserts retained is PublishedReview {
  if (retained === null) {
    throw new UsageError(
      'No published review is retained for this walk. Run `diffwalk publish` first.',
    )
  }
}

function validateUpdateService(service: string, retainedService: string): void {
  if (service !== retainedService) {
    throw new UsageError(
      `The retained review is hosted at ${retainedService}; update it there by passing only --update.`,
    )
  }
}
