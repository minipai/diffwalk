import { z } from 'zod'
import { currentWalkIfPresent } from '../../authoring/walk'
import { ServiceError, unpublishDocument } from '../../publish/client'
import { readPublishedReview, removePublishedReview, type PublishedReview } from '../published'
import { reportService } from '../service'
import { UsageError } from '../usage'

const unpublishOptionsSchema = z.object({
  token: z.string().optional(),
  service: z.string().optional(),
})

interface RetainedReview {
  review: PublishedReview
  path: string
}

export async function removeReview(reportId: string, options: z.input<typeof unpublishOptionsSchema>): Promise<void> {
  const { token, service: serviceOption } = unpublishOptionsSchema.parse(options)
  const retained = await readRetainedReview()
  const requestedService = serviceOption === undefined ? undefined : reportService(serviceOption)
  const matched = matchRetainedReview(retained, reportId, requestedService)
  const service = requestedService ?? reportService(matched?.review.service)
  const credential = token ?? matched?.review.revocationToken
  validateRevocationToken(credential)

  try {
    await unpublishDocument(reportId, service, credential)
  } catch (error) {
    // A matching credential proves this is the review this walk published. When the service
    // no longer has it, only the local record is stale: it was revoked, or expiry removed it.
    if (matched === null || !(error instanceof ServiceError) || error.status !== 404) throw error
    console.log(
      `Review ${reportId} no longer exists at ${service}; it was revoked, or it expired after 7 days.`,
    )
    await deleteRetainedReview(matched, `Review ${reportId} was already gone from ${service}`)
    return
  }
  console.log(`Removed review ${reportId} from ${service}`)

  if (matched === null) {
    remindRetainedReview(retained)
  } else {
    await deleteRetainedReview(matched, `Removed review ${reportId} from ${service}`)
  }
}

// The walk's retained review is the only local record of what this directory published. A
// missing walk or an absent file both mean there is nothing retained to clean up.
async function readRetainedReview(): Promise<RetainedReview | null> {
  const walk = await currentWalkIfPresent()
  if (walk === null) return null
  const review = await readPublishedReview(walk.published)
  return review === null ? null : { review, path: walk.published }
}

// A retained credential only vouches for its own review, at the host that issued it. Any
// other ID or host is a different review, which must carry its own token.
function matchRetainedReview(
  retained: RetainedReview | null,
  reportId: string,
  requestedService: string | undefined,
): RetainedReview | null {
  if (retained === null) return null
  if (retained.review.id !== reportId) return null
  if (requestedService !== undefined && requestedService !== retained.review.service) return null
  return retained
}

function remindRetainedReview(retained: RetainedReview | null): void {
  if (retained === null) return
  console.log(
    `Review ${retained.review.id} is still published at ${retained.review.url}; its credential stays at ${retained.path}.`,
  )
}

// The review is already gone from the service, so a credential left behind would recreate
// the invisible state this cleanup exists to remove. Report it instead of hiding it.
async function deleteRetainedReview(retained: RetainedReview, resolution: string): Promise<void> {
  try {
    await removePublishedReview(retained.path)
  } catch (error) {
    throw new Error(
      `${resolution}, but could not delete ${retained.path}: ${(error as Error).message}. Delete that file yourself so the walk does not look published.`,
    )
  }
}

function validateRevocationToken(token: string | undefined): asserts token is string {
  if (token === undefined) {
    throw new UsageError(
      "Pass the review's revocation token with --token; a retained token is only used for the review this walk published.",
    )
  }
}
