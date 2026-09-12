import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configuredService,
  findProjectConfig,
  readProjectConfig,
} from '../src/authoring/config'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

// diffwalk's project is a Git work tree, so the fixture marks the root the same way a
// checkout does. Creating the entry directly keeps the lookup tests independent of Git.
async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'diffwalk-config-'))
  directories.push(directory)
  await mkdir(join(directory, '.git'), { recursive: true })
  return directory
}

async function writeConfig(root: string, text: string): Promise<string> {
  const directory = join(root, '.diffwalk')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'config.json')
  await writeFile(path, text)
  return path
}

describe('project config lookup', () => {
  test('an absent config means no project service', async () => {
    const directory = await temporaryProject()

    expect(findProjectConfig(directory)).toBeNull()
    expect(readProjectConfig(directory)).toBeNull()
    expect(configuredService(directory)).toBeUndefined()
  })

  test('reads the work-tree root config so a subdirectory resolves the project', async () => {
    const root = await temporaryProject()
    const path = await writeConfig(root, JSON.stringify({ service: 'https://reports.example' }))
    const nested = join(root, 'packages', 'app', 'src')
    await mkdir(nested, { recursive: true })

    expect(findProjectConfig(nested)).toBe(path)
    expect(configuredService(nested)).toBe('https://reports.example')
  })

  test('a config above the work-tree root is outside the project and ignored', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'diffwalk-config-'))
    directories.push(outer)
    await writeConfig(outer, JSON.stringify({ service: 'https://outer.example' }))
    const root = join(outer, 'checkout')
    await mkdir(join(root, '.git'), { recursive: true })

    expect(configuredService(root)).toBeUndefined()
  })

  test('there is no project config outside a Git work tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-config-'))
    directories.push(directory)
    await writeConfig(directory, JSON.stringify({ service: 'https://reports.example' }))

    expect(findProjectConfig(directory)).toBeNull()
    expect(configuredService(directory)).toBeUndefined()
  })

  test('an empty object is valid and leaves the service unset', async () => {
    const root = await temporaryProject()
    await writeConfig(root, '{}')

    expect(readProjectConfig(root)).toEqual({})
    expect(configuredService(root)).toBeUndefined()
  })

  test('malformed JSON names the file instead of silently defaulting', async () => {
    const root = await temporaryProject()
    const path = await writeConfig(root, '{not json')

    expect(() => readProjectConfig(root)).toThrow(path)
    expect(() => readProjectConfig(root)).toThrow('Invalid JSON')
  })

  test('a schema violation names the file', async () => {
    const root = await temporaryProject()
    const path = await writeConfig(root, JSON.stringify({ service: 42 }))

    expect(() => readProjectConfig(root)).toThrow(path)
    expect(() => readProjectConfig(root)).toThrow('Invalid Diffwalk config')
  })

  test('an unknown key is refused', async () => {
    const root = await temporaryProject()
    const path = await writeConfig(root, JSON.stringify({ serviec: 'https://reports.example' }))

    expect(() => readProjectConfig(root)).toThrow(path)
  })
})
