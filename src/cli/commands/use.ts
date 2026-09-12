import { setCurrentWalk, walkExists } from '../../authoring/walk'

export async function useCommand(id: string): Promise<void> {
  if (!(await walkExists(id))) throw new Error(`No Diffwalk walk ${id}.`)
  await setCurrentWalk(id)
  console.log(`Current walk: ${id}`)
}
