import { deleteWalk, walkExists, walkPaths } from '../../authoring/walk'
import { readPublishedReview, type PublishedReview } from '../published'
import { UsageError } from '../usage'

export interface DeleteOptions {
  force?: boolean
}

export async function removeWalk(walkId: string, options: DeleteOptions = {}): Promise<void> {
  const abandoned = await validateNoLiveReview(walkId, options.force === true)
  const clearedCurrent = await deleteWalk(walkId)
  const next = clearedCurrent
    ? '\nCleared the current walk; run `diffwalk use <walk-id>` to select another.'
    : ''
  console.log(`Deleted walk ${walkId}.${next}`)
  if (abandoned !== null) {
    console.log(
      `Review ${abandoned.id} at ${abandoned.url} is still live; its revocation token was deleted with the walk.`,
    )
  }
}

// Deleting the walk deletes its only copy of the revocation token. When the review is
// still live, that turns a local cleanup into an orphan that only the 7-day expiry ends,
// so `--force` is the only way through — and it still names what it gives up.
async function validateNoLiveReview(walkId: string, force: boolean): Promise<PublishedReview | null> {
  if (!(await walkExists(walkId))) return null
  const retained = await readPublishedReview(walkPaths(walkId).published)
  if (retained === null || force) return retained
  throw new UsageError(
    `Walk ${walkId} still has a live review at ${retained.url}. Select it with \`diffwalk use ${walkId}\` and run \`diffwalk unpublish ${retained.id}\` first, or pass --force to delete the walk and lose its credential.`,
  )
}
