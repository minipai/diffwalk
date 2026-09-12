import { currentWalkIdIfPresent, listWalkIds } from '../../authoring/walk'

export async function printWalks(): Promise<void> {
  const walkIds = await listWalkIds()
  if (walkIds.length === 0) {
    console.log('No Diffwalk walks. Run `diffwalk inspect` first.')
    return
  }
  const currentWalkId = await currentWalkIdIfPresent()
  const heading = `${walkIds.length} ${walkIds.length === 1 ? 'walk' : 'walks'}`
  const lines = walkIds.map((walkId) => `${walkId}${walkId === currentWalkId ? '  (current)' : ''}`)
  console.log([heading, ...lines].join('\n'))
}
