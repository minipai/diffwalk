import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentWalk, currentWalkIfPresent, setCurrentWalk, walkId, walkPaths } from '../src/walk'

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
