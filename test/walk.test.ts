import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  currentWalk,
  currentWalkIdIfPresent,
  currentWalkIfPresent,
  deleteWalk,
  listWalkIds,
  setCurrentWalk,
  walkExists,
  walkId,
  walkPaths,
} from '../src/authoring/walk'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('walk paths', () => {
  test('combines an ISO 8601 basic timestamp with the capture prefix', () => {
    expect(
      walkId('2026-08-31T06:38:42.123Z', 'a7c9e4f28b97f0d38c1e'.padEnd(64, '0')),
    ).toBe('20260831T063842Z-a7c9e4f2')
  })

  test('keeps one capture, explanations, and both exports in the walk directory', () => {
    expect(walkPaths('20260831T063842Z-a7c9e4f2')).toEqual({
      id: '20260831T063842Z-a7c9e4f2',
      directory: join('.diffwalk', '20260831T063842Z-a7c9e4f2'),
      capture: join('.diffwalk', '20260831T063842Z-a7c9e4f2', 'capture.json'),
      explanations: join('.diffwalk', '20260831T063842Z-a7c9e4f2', 'explanations.yaml'),
      html: join('.diffwalk', '20260831T063842Z-a7c9e4f2', 'diffwalk.html'),
      json: join('.diffwalk', '20260831T063842Z-a7c9e4f2', 'diffwalk.json'),
      published: join('.diffwalk', '20260831T063842Z-a7c9e4f2', 'published.json'),
    })
  })

  test('writes and reads the current walk without accepting arbitrary paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-paths-'))
    directories.push(root)
    expect(await currentWalkIfPresent(root)).toBeNull()

    await setCurrentWalk('20260831T063842Z-a7c9e4f2', root)

    expect(await readFile(join(root, 'current'), 'utf8')).toBe(
      '20260831T063842Z-a7c9e4f2\n',
    )
    expect((await currentWalk(root)).id).toBe('20260831T063842Z-a7c9e4f2')
    expect(() => walkPaths('../outside', root)).toThrow('Invalid Diffwalk walk ID')
  })
})

describe('walk management', () => {
  const older = '20260831T063842Z-a7c9e4f2'
  const newer = '20260901T101500Z-deadbeef'

  test('lists walk directories newest first and reports the current one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-walks-'))
    directories.push(root)
    expect(await listWalkIds(root)).toEqual([])

    await mkdir(walkPaths(older, root).directory, { recursive: true })
    await mkdir(walkPaths(newer, root).directory, { recursive: true })
    await writeFile(join(root, 'notes.txt'), 'not a walk\n')
    await setCurrentWalk(older, root)

    expect(await listWalkIds(root)).toEqual([newer, older])
    expect(await currentWalkIdIfPresent(root)).toBe(older)
    expect(await walkExists(newer, root)).toBe(true)
    expect(await walkExists('20260901T101500Z-ffffffff', root)).toBe(false)
  })

  test('deletes a walk and keeps or clears the current pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-delete-'))
    directories.push(root)
    await mkdir(walkPaths(older, root).directory, { recursive: true })
    await mkdir(walkPaths(newer, root).directory, { recursive: true })
    await setCurrentWalk(newer, root)

    expect(await deleteWalk(older, root)).toBe(false)
    expect(await walkExists(older, root)).toBe(false)
    expect(await currentWalkIdIfPresent(root)).toBe(newer)

    expect(await deleteWalk(newer, root)).toBe(true)
    expect(await walkExists(newer, root)).toBe(false)
    expect(await currentWalkIdIfPresent(root)).toBeNull()

    await expect(deleteWalk(older, root)).rejects.toThrow('No Diffwalk walk')
  })

  test('refuses to delete a non-directory entry that looks like a walk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-delete-file-'))
    directories.push(root)
    await writeFile(walkPaths(older, root).directory, 'not a walk\n')

    await expect(deleteWalk(older, root)).rejects.toThrow('No Diffwalk walk')

    expect(await readFile(walkPaths(older, root).directory, 'utf8')).toBe('not a walk\n')
  })

  test('clears a dangling current pointer when its walk is deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-dangling-'))
    directories.push(root)
    await setCurrentWalk(older, root)

    expect(await deleteWalk(older, root)).toBe(true)
    expect(await currentWalkIdIfPresent(root)).toBeNull()
  })

  test('does not treat a symlinked directory as a walk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diffwalk-symlink-'))
    const target = await mkdtemp(join(tmpdir(), 'diffwalk-target-'))
    directories.push(root, target)
    await symlink(target, walkPaths(older, root).directory)

    expect(await walkExists(older, root)).toBe(false)
    expect(await listWalkIds(root)).toEqual([])
  })
})
