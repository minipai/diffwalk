import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const diffwalkDirectory = '.diffwalk'

export interface WalkPaths {
  id: string
  directory: string
  capture: string
  explanations: string
  html: string
  json: string
  published: string
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
    published: join(directory, 'published.json'),
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
  const id = await currentWalkIdIfPresent(root)
  return id === null ? null : walkPaths(id, root)
}

export async function currentWalkIdIfPresent(root = diffwalkDirectory): Promise<string | null> {
  const currentPath = join(root, 'current')
  try {
    return (await readFile(currentPath, 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function setCurrentWalk(id: string, root = diffwalkDirectory): Promise<void> {
  walkPaths(id, root)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'current'), `${id}\n`)
}

export async function listWalkIds(root = diffwalkDirectory): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && walkIdPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
}

export async function walkExists(id: string, root = diffwalkDirectory): Promise<boolean> {
  const paths = walkPaths(id, root)
  try {
    return (await lstat(paths.directory)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function deleteWalk(id: string, root = diffwalkDirectory): Promise<boolean> {
  const paths = walkPaths(id, root)
  const wasCurrent = (await currentWalkIdIfPresent(root)) === id
  if (await walkExists(id, root)) {
    await rm(paths.directory, { recursive: true })
  } else if (!wasCurrent) {
    throw new Error(`No Diffwalk walk ${id} to delete.`)
  }
  if (wasCurrent) await rm(join(root, 'current'), { force: true })
  return wasCurrent
}
