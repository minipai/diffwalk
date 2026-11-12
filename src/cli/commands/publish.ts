import { z } from 'zod'
import { gitUserName } from '../../authoring/git'
import { materialize } from '../input'
import { readPublishedReview, writePublishedReview, type PublishedReview } from '../published'
import { publishDocument, ServiceError, updateDocument, withPublisher } from '../../publish/client'
import type { ExplainDocument } from '../../format/types'
import { reportService } from '../service'
import { UsageError } from '../usage'

const publishOptionsSchema = z.object({
  input: z.string().optional(),
  explanations: z.string().optional(),
  service: z.string().optional(),
  update: z.boolean().default(false),
  new: z.boolean().default(false),
})

export async function publishReview(options: z.input<typeof publishOptionsSchema>): Promise<void> {
  const { input, explanations, service, update, new: createNew } = publishOptionsSchema.parse(options)
  validatePublicationIntent(update, createNew)
  const { document, paths } = await materialize({ input, explanations })
  const outgoing = withPublisher(document, await gitUserName())
  const retained = await readPublishedReview(paths.published)
  switch (update) {
    case true:
      await updatePublishedReview(outgoing, retained, paths.published, service)
      break
    case false:
      await createPublishedReview(outgoing, paths.published, service, retained, createNew)
      break
  }
}

async function createPublishedReview(
  document: ExplainDocument,
  path: string,
  serviceOption: string | undefined,
  retained: PublishedReview | null,
  allowReplacement: boolean,
): Promise<void> {
  validateNoRetainedReview(retained, allowReplacement)
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
  // The new credential has replaced the old one, so this is the last moment its token can
  // be shown. Otherwise `--new` would silently orphan a review that only expiry can remove.
  announceAbandonedReview(retained)
}

async function updatePublishedReview(
  document: ExplainDocument,
  retained: PublishedReview | null,
  path: string,
  serviceOption: string | undefined,
): Promise<void> {
  validateRetainedReview(retained)

  // Validate the stored service too, so a damaged retained file can never aim the
  // revocation token at an arbitrary or plaintext host.
  const service = reportService(serviceOption ?? retained.service)
  validateUpdateService(service, retained.service)

  try {
    await updateDocument(document, retained.id, service, retained.revocationToken)
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) {
      throw new Error(
        `Review ${retained.id} no longer exists at ${service}. It was revoked, or it expired after 7 days. The credential retained at ${path} cannot update it; delete that file to publish a new review.`,
      )
    }
    throw error
  }
  console.log(`Updated ${document.sections.length} explanation sections at ${retained.url}
Review ${retained.id} keeps its link and revocation token.`)
}

function validatePublicationIntent(update: boolean, createNew: boolean): void {
  if (update && createNew) {
    throw new UsageError('Pass either --update or --new, not both.')
  }
}

// A retained credential is the only way back to the review it names, so replacing it takes
// an explicit choice: update that review, or say `--new` and accept a second link.
function validateNoRetainedReview(retained: PublishedReview | null, allowReplacement: boolean): void {
  if (retained === null || allowReplacement) return
  throw new UsageError(
    `This walk is already published at ${retained.url}. Replace that link's content with \`diffwalk publish --update\`, or publish a separate review with \`diffwalk publish --new\`.`,
  )
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

function announceAbandonedReview(retained: PublishedReview | null): void {
  if (retained === null) return
  console.log(
    `Review ${retained.id} is still live at ${retained.url}. Remove it with \`diffwalk unpublish ${retained.id} --token ${retained.revocationToken}\` before it expires.`,
  )
}
