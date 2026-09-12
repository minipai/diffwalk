import { deleteWalk } from '../../authoring/walk'

export async function deleteCommand(id: string): Promise<void> {
  const clearedCurrent = await deleteWalk(id)
  console.log(`Deleted walk ${id}.`)
  if (clearedCurrent) {
    console.log('Cleared the current walk; run `diffwalk use <walk-id>` to select another.')
  }
}
