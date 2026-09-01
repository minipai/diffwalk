import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureGitChanges, captureGitRevisionChanges } from '../src/git'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('captureGitChanges', () => {
  test('captures tracked, deleted, renamed, and untracked working-tree files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await writeFile(join(directory, 'deleted.ts'), 'delete me\n')
    await writeFile(join(directory, 'old-name.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'new\n')
    await unlink(join(directory, 'deleted.ts'))
    await rename(join(directory, 'old-name.ts'), join(directory, 'new-name.ts'))
    await git(['add', '-A'], directory)
    await writeFile(join(directory, 'untracked.ts'), 'untracked\n')
    await mkdir(join(directory, '.diffwalk'))
    await writeFile(join(directory, '.diffwalk', 'current'), 'local-only\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(capture.files).toEqual([
      {
        path: 'deleted.ts',
        status: 'deleted',
        oldContent: 'delete me\n',
        newContent: '',
      },
      {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        status: 'renamed',
        oldContent: 'same\n',
        newContent: 'same\n',
      },
      {
        path: 'tracked.ts',
        status: 'modified',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
      {
        path: 'untracked.ts',
        status: 'added',
        oldContent: '',
        newContent: 'untracked\n',
      },
    ])
  })

  test('rejects file mode changes that cannot be represented in the document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\n')
    await git(['add', 'script.sh'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)
    await chmod(join(directory, 'script.sh'), 0o755)

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'File mode changes are not supported: script.sh',
    )
  })

  test('rejects symbolic links instead of reading their targets', async () => {
    if (process.platform === 'win32') return

    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'tracked\n')
    await git(['add', 'tracked.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)
    await writeFile(join(directory, 'target.ts'), 'target\n')
    await symlink('target.ts', join(directory, 'link.ts'))

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'Symbolic links are not supported: link.ts',
    )
  })

  test('captures committed revisions without reading the working tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'one\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'one'], directory)
    const first = (await gitText(['rev-parse', 'HEAD'], directory)).trim()
    await writeFile(join(directory, 'tracked.ts'), 'two\n')
    await writeFile(join(directory, 'untracked.ts'), 'ignore\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'two'], directory)
    const second = (await gitText(['rev-parse', 'HEAD'], directory)).trim()
    await writeFile(join(directory, 'tracked.ts'), 'working tree\n')
    await writeFile(join(directory, 'current-only.ts'), 'ignore\n')

    const capture = await captureGitRevisionChanges(first, second, directory)

    expect(capture.files).toEqual([
      { path: 'tracked.ts', status: 'modified', oldContent: 'one\n', newContent: 'two\n' },
      { path: 'untracked.ts', status: 'added', oldContent: '', newContent: 'ignore\n' },
    ])
  })
})

async function initializeRepository(directory: string) {
  await git(['init', '-q'], directory)
  await git(['config', 'user.name', 'Test'], directory)
  await git(['config', 'user.email', 'test@example.com'], directory)
}

async function git(args: string[], cwd: string) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (exitCode !== 0) throw new Error(stderr)
}

async function gitText(args: string[], cwd: string) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr)
  return stdout
}
