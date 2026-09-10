import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const diffwalkDirectory = '.diffwalk'

export interface WalkPaths {
  id: string
  directory: string
  capture: string
  explanations: string
  html: string
  json: string
}

const walkIdPattern = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/

export function walkId(capturedAt: string, captureId: string): string {
  const timestamp = capturedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${timestamp}-${captureId.slice(0, 8)}`
}

export function walkPaths(id: string, root = diffwalkDirectory): WalkPaths {
  if (!walkIdPattern.test(id)) throw new Error(`Invalid Diffwalk walk ID: ${id}`)
  const directory = join(root, id)
  return {
    id,
    directory,
    capture: join(directory, 'capture.json'),
    explanations: join(directory, 'explanations.yaml'),
    html: join(directory, 'diffwalk.html'),
    json: join(directory, 'diffwalk.json'),
  }
}

export async function currentWalk(root = diffwalkDirectory): Promise<WalkPaths> {
  const paths = await currentWalkIfPresent(root)
  if (paths === null) {
    throw new Error(`No current Diffwalk capture. Run \`diffwalk inspect\` first.`)
  }
  return paths
}

export async function currentWalkIfPresent(root = diffwalkDirectory): Promise<WalkPaths | null> {
  const currentPath = join(root, 'current')
  let id: string
  try {
    id = (await readFile(currentPath, 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return walkPaths(id, root)
}

export async function setCurrentWalk(id: string, root = diffwalkDirectory): Promise<void> {
  walkPaths(id, root)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'current'), `${id}\n`)
}
