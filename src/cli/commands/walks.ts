import { currentWalkIdIfPresent, listWalkIds, walkPaths } from '../../authoring/walk'
import { readPublishedReview } from '../published'

export async function printWalks(): Promise<void> {
  const walkIds = await listWalkIds()
  if (walkIds.length === 0) {
    console.log('No Diffwalk walks. Run `diffwalk inspect` first.')
    return
  }
  const currentWalkId = await currentWalkIdIfPresent()
  const heading = `${walkIds.length} ${walkIds.length === 1 ? 'walk' : 'walks'}`
  const lines = await Promise.all(walkIds.map((walkId) => describeWalk(walkId, currentWalkId)))
  console.log([heading, ...lines].join('\n'))
}

// Publishing is invisible otherwise: a walk directory alone cannot say whether a review is
// still live, so name the link beside the walk it belongs to.
async function describeWalk(walkId: string, currentWalkId: string | null): Promise<string> {
  const markers: string[] = []
  if (walkId === currentWalkId) markers.push('(current)')
  const publication = await publicationMarker(walkId)
  if (publication !== null) markers.push(publication)
  return markers.length === 0 ? walkId : `${walkId}  ${markers.join('  ')}`
}

async function publicationMarker(walkId: string): Promise<string | null> {
  const path = walkPaths(walkId).published
  try {
    const review = await readPublishedReview(path)
    return review === null ? null : `published ${review.url}`
  } catch {
    // A damaged credential must not make the whole listing fail, but hiding it would make
    // the walk look unpublished, so point at the file that needs attention.
    return `published (unreadable credential at ${path})`
  }
}
