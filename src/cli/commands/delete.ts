import { deleteWalk } from '../../authoring/walk'

export async function removeWalk(walkId: string): Promise<void> {
  const clearedCurrent = await deleteWalk(walkId)
  const next = clearedCurrent
    ? '\nCleared the current walk; run `diffwalk use <walk-id>` to select another.'
    : ''
  console.log(`Deleted walk ${walkId}.${next}`)
}
