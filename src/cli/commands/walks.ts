import { currentWalkIdIfPresent, listWalkIds } from '../../authoring/walk'

export async function walksCommand(): Promise<void> {
  const ids = await listWalkIds()
  if (ids.length === 0) {
    console.log('No Diffwalk walks. Run `diffwalk inspect` first.')
    return
  }
  const current = await currentWalkIdIfPresent()
  console.log(`${ids.length} ${ids.length === 1 ? 'walk' : 'walks'}`)
  for (const id of ids) console.log(`${id}${id === current ? '  (current)' : ''}`)
}
