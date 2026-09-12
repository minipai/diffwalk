import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
const script = new URL('../scripts/release.mjs', import.meta.url).pathname

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('release commit selection', () => {
  for (const annotated of [false, true]) {
    test(`publishes the tagged PR commit after a merge (${annotated ? 'annotated' : 'lightweight'} tag)`, () => {
      const directory = repository()
      const release = commit(directory, '3.2.1')
      git(directory, ...(annotated ? ['tag', '-a', 'v3.2.1', '-m', 'release'] : ['tag', 'v3.2.1']))
      // Later PR changes must not silently become the published artifact.
      const head = commit(directory, '3.2.1', 'Follow-up documentation')
      const merge = mergePr(directory)

      const result = resolve(directory, head, merge)

      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${release}\n`)
    })
  }

  test('does not publish an unmerged PR even when its tag exists', () => {
    const directory = repository()
    const head = commit(directory, '3.2.1')
    git(directory, 'tag', 'v3.2.1')

    const result = resolve(directory, head, head, false)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('does not publish a merged PR without a matching version tag', () => {
    const directory = repository()
    const head = commit(directory, '3.2.1')

    const result = resolve(directory, head, mergePr(directory))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('does not republish a tag already present in main before this PR', () => {
    const directory = repository()
    git(directory, 'tag', 'v3.2.0', 'main')
    const head = commit(directory, '3.2.0', 'An ordinary change')

    const result = resolve(directory, head, mergePr(directory))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('rejects squash merging a tagged release', () => {
    const directory = repository()
    const head = commit(directory, '3.2.1')
    git(directory, 'tag', 'v3.2.1')
    git(directory, 'switch', 'main')
    git(directory, 'merge', '--squash', 'release')
    git(directory, 'commit', '-m', 'Squash the release')

    expect(resolve(directory, head, git(directory, 'rev-parse', 'HEAD')).status).not.toBe(0)
  })

  test('rejects rebase merging a tagged release', () => {
    const directory = repository()
    const head = commit(directory, '3.2.1')
    git(directory, 'tag', 'v3.2.1')
    git(directory, 'switch', 'main')
    git(directory, 'commit', '--allow-empty', '-m', 'Advance main')
    git(directory, 'switch', 'release')
    git(directory, 'rebase', 'main')
    git(directory, 'switch', 'main')
    git(directory, 'merge', '--ff-only', 'release')

    expect(resolve(directory, head, git(directory, 'rev-parse', 'HEAD')).status).not.toBe(0)
  })

  test('rejects a matching tag from an unrelated branch', () => {
    const directory = repository()
    const head = commit(directory, '3.2.1')
    git(directory, 'switch', '-c', 'other', 'main')
    commit(directory, '3.2.1', 'A different release')
    git(directory, 'tag', 'v3.2.1')

    expect(resolve(directory, head, mergePr(directory)).status).not.toBe(0)
  })

  test('rejects a tag whose package version differs from its name', () => {
    const directory = repository()
    commit(directory, '3.2.1')
    git(directory, 'tag', 'v3.2.2')
    const head = commit(directory, '3.2.2')

    expect(resolve(directory, head, mergePr(directory)).status).not.toBe(0)
  })

  for (const version of ['3.2.1-beta.1', '03.2.1']) {
    test(`rejects unstable or noncanonical release version ${version}`, () => {
      const directory = repository()
      const head = commit(directory, version)
      git(directory, 'tag', `v${version}`)

      expect(resolve(directory, head, mergePr(directory)).status).not.toBe(0)
    })
  }
})

function repository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'diffwalk-release-'))
  directories.push(directory)
  git(directory, 'init', '-b', 'main')
  git(directory, 'config', 'user.name', 'Release Test')
  git(directory, 'config', 'user.email', 'release@example.test')
  git(directory, 'config', 'commit.gpgsign', 'false')
  git(directory, 'config', 'tag.gpgsign', 'false')
  commit(directory, '3.2.0')
  git(directory, 'switch', '-c', 'release')
  return directory
}

function commit(directory: string, version: string, message = `Release ${version}`): string {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'release-fixture', version }))
  git(directory, 'add', 'package.json')
  git(directory, 'commit', '--allow-empty', '-m', message)
  return git(directory, 'rev-parse', 'HEAD')
}

function mergePr(directory: string): string {
  git(directory, 'switch', 'main')
  git(directory, 'merge', '--no-ff', 'release', '-m', 'Merge release PR')
  return git(directory, 'rev-parse', 'HEAD')
}

function resolve(directory: string, head: string, merge: string, merged = true) {
  const event = join(directory, 'event.json')
  writeFileSync(event, JSON.stringify({ pull_request: { merged, head: { sha: head }, merge_commit_sha: merge } }))
  return spawnSync('node', [script, '--resolve'], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_PATH: event },
  })
}

function git(directory: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}
