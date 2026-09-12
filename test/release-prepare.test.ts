import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
const script = new URL('../scripts/release.mjs', import.meta.url).pathname

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('release preparation', () => {
  test('pushes the version commit and tag together, then opens a manual release PR', () => {
    const fixture = repository()
    const base = git(fixture.repo, 'rev-parse', 'origin/main')
    git(fixture.repo, 'switch', '-c', 'other-work')
    writeFileSync(join(fixture.repo, 'unrelated.txt'), 'Not part of the release\n')
    git(fixture.repo, 'add', '.')
    git(fixture.repo, 'commit', '-m', 'Unrelated work')

    const result = prepare(fixture, '3.10.0')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('https://github.example/fixture/pull/1')
    expect(git(fixture.repo, 'branch', '--show-current')).toBe('release/v3.10.0')
    const head = git(fixture.repo, 'rev-parse', 'HEAD')
    expect(git(fixture.repo, 'rev-parse', 'HEAD^')).toBe(base)
    expect(git(fixture.repo, 'rev-parse', 'v3.10.0')).toBe(head)
    expect(git(fixture.remote, 'rev-parse', 'refs/heads/release/v3.10.0')).toBe(head)
    expect(git(fixture.remote, 'rev-parse', 'refs/tags/v3.10.0')).toBe(head)
    expect(git(fixture.remote, 'rev-parse', 'main')).toBe(base)
    expect(git(fixture.repo, 'diff', 'HEAD^', 'HEAD', '--name-only')).toBe('package.json')
    expect(JSON.parse(readFileSync(join(fixture.repo, 'package.json'), 'utf8')).version).toBe('3.10.0')
    expect(git(fixture.repo, 'show', '-s', '--format=%an <%ae>')).toBe('Release Test <release@example.test>')
    expect(git(fixture.repo, 'show', '-s', '--format=%B')).toContain('Co-Authored-By: ことね <kotone@claudecafe.dev>')
    const calls = ghCalls(fixture)
    expect(calls.map((call) => call.args)).toEqual([
      ['auth', 'status'],
      ['api', 'user', '--jq', '.login'],
      ['pr', 'create', '--base', 'main', '--head', 'release/v3.10.0', '--title', 'Release v3.10.0', '--body-file', '-'],
      ['pr', 'merge', 'https://github.example/fixture/pull/1', '--disable-auto'],
    ])
    expect(calls[2]?.body).toContain('Create a merge commit')
    expect(calls[2]?.body).toContain('Do not squash, rebase, or enable auto-merge')
  })

  test('refuses a dirty working tree before calling GitHub or changing refs', () => {
    const fixture = repository()
    writeFileSync(join(fixture.repo, 'notes.txt'), 'Uncommitted work\n')

    const result = prepare(fixture, '3.10.0')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Commit or stash')
    expect(ghCalls(fixture)).toEqual([])
    expect(git(fixture.repo, 'branch', '--show-current')).toBe('main')
    expect(git(fixture.repo, 'tag', '--list')).toBe('')
  })

  for (const version of ['3.9.0', '3.8.9', '3.10.0-beta.1']) {
    test(`refuses a nonincreasing or unstable version ${version}`, () => {
      const fixture = repository()

      expect(prepare(fixture, version).status).not.toBe(0)
      expect(git(fixture.repo, 'branch', '--show-current')).toBe('main')
      expect(git(fixture.repo, 'tag', '--list')).toBe('')
      expect(ghCalls(fixture).some((call) => call.args[0] === 'pr')).toBe(false)
    })
  }

  test('refuses an existing remote release tag even when it is absent locally', () => {
    const fixture = repository()
    git(fixture.remote, 'tag', 'v3.10.0', 'main')

    const result = prepare(fixture, '3.10.0')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('already exists')
    expect(git(fixture.repo, 'branch', '--show-current')).toBe('main')
    expect(ghCalls(fixture).some((call) => call.args[0] === 'pr')).toBe(false)
  })

  test('refuses preparation until the release workflows are merged into main', () => {
    const fixture = repository()
    writeFileSync(join(fixture.repo, '.github/workflows/publish.yml'), 'on:\n  push:\n    tags: ["v*"]\n')
    git(fixture.repo, 'add', '.')
    git(fixture.repo, 'commit', '-m', 'Use old publish workflow')
    git(fixture.repo, 'push', 'origin', 'main')

    const result = prepare(fixture, '3.10.0')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Merge the PR-based release workflow')
    expect(git(fixture.repo, 'tag', '--list')).toBe('')
    expect(ghCalls(fixture).some((call) => call.args[0] === 'pr')).toBe(false)
  })
})

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'diffwalk-release-prepare-'))
  directories.push(directory)
  const repo = join(directory, 'repo')
  const remote = join(directory, 'remote.git')
  const bin = join(directory, 'bin')
  const log = join(directory, 'gh.jsonl')
  mkdirSync(repo)
  mkdirSync(bin)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Release Test')
  git(repo, 'config', 'user.email', 'release@example.test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'config', 'tag.gpgsign', 'false')
  mkdirSync(join(repo, '.github/workflows'), { recursive: true })
  writeFileSync(join(repo, '.github/workflows/publish.yml'), 'on:\n  pull_request:\n    types: [closed]\n')
  writeFileSync(join(repo, '.github/workflows/auto-merge.yml'), "# startsWith(github.event.pull_request.head.ref, 'release/')\n")
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'release-fixture', version: '3.9.0' }, null, 2)}\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'Initial fixture')
  git(directory, 'init', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-u', 'origin', 'main')
  const mock = join(bin, 'gh')
  writeFileSync(mock, `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const body = args[0] === 'pr' && args[1] === 'create' ? readFileSync(0, 'utf8') : '';
appendFileSync(process.env.RELEASE_TEST_GH_LOG, JSON.stringify({ args, body }) + '\\n');
if (args[0] === 'auth' && args[1] === 'status') process.exit(0);
if (args[0] === 'api' && args[1] === 'user') { console.log('claudecafe'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') { console.log('https://github.example/fixture/pull/1'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge' && args[3] === '--disable-auto') process.exit(0);
console.error('Unexpected mock gh call', args);
process.exit(1);
`)
  chmodSync(mock, 0o755)
  return { repo, remote, bin, log }
}

function prepare(fixture: ReturnType<typeof repository>, version: string) {
  return spawnSync('node', [script, version], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, RELEASE_TEST_GH_LOG: fixture.log },
  })
}

function ghCalls(fixture: ReturnType<typeof repository>): { args: string[]; body: string }[] {
  return existsSync(fixture.log)
    ? readFileSync(fixture.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    : []
}

function git(directory: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}
