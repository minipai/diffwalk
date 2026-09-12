import { lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { diffwalkDirectory } from '../authoring/walk'

export const projectConfigFileName = 'config.json'

// A project-level setting lives beside the walks but is not part of any walk. It is
// optional, so the schema allows an empty object and rejects unknown keys.
export const projectConfigSchema = z
  .object({
    service: z.string().optional(),
  })
  .strict()
export interface ProjectConfig {
  service?: string
}

export function configuredService(directory = process.cwd()): string | undefined {
  return readProjectConfig(directory)?.service
}

export function readProjectConfig(directory = process.cwd()): ProjectConfig | null {
  const path = findProjectConfig(directory)
  if (path === null) return null
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`Could not read the Diffwalk config at ${path}: ${(error as Error).message}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in the Diffwalk config at ${path}: ${(error as Error).message}`)
  }
  try {
    return projectConfigSchema.parse(value)
  } catch (error) {
    throw new Error(`Invalid Diffwalk config at ${path}: ${(error as Error).message}`)
  }
}

// The project is the Git work tree, so its config only sits at the work-tree root. A
// `.diffwalk/config.json` above the root belongs to some outer directory, not this
// project, and is ignored; outside a work tree there is no project config at all.
export function findProjectConfig(directory = process.cwd()): string | null {
  const root = workTreeRoot(directory)
  if (root === null) return null
  const candidate = join(root, diffwalkDirectory, projectConfigFileName)
  return entryExists(candidate) ? candidate : null
}

function workTreeRoot(directory: string): string | null {
  let current = resolve(directory)
  for (;;) {
    if (entryExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

// A config entry that exists but cannot be stat'd must not be mistaken for "absent" and
// silently fall back to the hosted default, so only ENOENT means missing.
function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
