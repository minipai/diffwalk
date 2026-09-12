import { setCurrentWalk, walkExists } from '../../authoring/walk'

export async function selectWalk(walkId: string): Promise<void> {
  await validateWalkExists(walkId)
  await setCurrentWalk(walkId)
  console.log(`Current walk: ${walkId}`)
}

async function validateWalkExists(walkId: string): Promise<void> {
  if (!(await walkExists(walkId))) throw new Error(`No Diffwalk walk ${walkId}.`)
}
