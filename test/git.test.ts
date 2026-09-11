import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureGitChanges, captureGitRevisionChanges } from '../src/authoring/git'

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
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'delete me\n',
        newContent: '',
      },
      {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'same\n',
        newContent: 'same\n',
      },
      {
        path: 'tracked.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
      {
        path: 'untracked.ts',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: 'untracked\n',
      },
    ])
  })

  test('captures executable additions, deletions, and untracked files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'deleted.sh'), '#!/bin/sh\necho deleted\n')
    await chmod(join(directory, 'deleted.sh'), 0o755)
    await git(['add', 'deleted.sh'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await unlink(join(directory, 'deleted.sh'))
    await writeFile(join(directory, 'added.sh'), '#!/bin/sh\necho added\n')
    await chmod(join(directory, 'added.sh'), 0o755)
    await git(['add', 'added.sh'], directory)
    await writeFile(join(directory, 'untracked.sh'), '#!/bin/sh\necho untracked\n')
    await chmod(join(directory, 'untracked.sh'), 0o755)

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'added.sh',
        status: 'added',
        oldMode: '000000',
        newMode: '100755',
        oldContent: '',
        newContent: '#!/bin/sh\necho added\n',
      },
      {
        path: 'deleted.sh',
        status: 'deleted',
        oldMode: '100755',
        newMode: '000000',
        oldContent: '#!/bin/sh\necho deleted\n',
        newContent: '',
      },
      {
        path: 'untracked.sh',
        status: 'added',
        oldMode: '000000',
        newMode: '100755',
        oldContent: '',
        newContent: '#!/bin/sh\necho untracked\n',
      },
    ])
  })

  test('captures regular and executable replacements after staged deletions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'regular.txt'), 'old regular\n')
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\necho old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['rm', '--cached', '-q', 'regular.txt', 'script.sh'], directory)
    await writeFile(join(directory, 'regular.txt'), 'new regular\n')
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\necho new\n')
    await chmod(join(directory, 'script.sh'), 0o755)

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'regular.txt',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'old regular\n',
        newContent: 'new regular\n',
      },
      {
        path: 'script.sh',
        status: 'modified',
        oldMode: '100644',
        newMode: '100755',
        oldContent: '#!/bin/sh\necho old\n',
        newContent: '#!/bin/sh\necho new\n',
      },
    ])
  })

  test('rejects a binary replacement after a staged deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'replacement.dat'), 'text\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['rm', '--cached', '-q', 'replacement.dat'], directory)
    await writeFile(join(directory, 'replacement.dat'), new Uint8Array([0, 1, 2]))

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'Binary files are not supported: replacement.dat',
    )
  })

  test('rejects a symbolic-link replacement after a staged deletion', async () => {
    if (process.platform === 'win32') return

    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'replacement.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['rm', '--cached', '-q', 'replacement.ts'], directory)
    await unlink(join(directory, 'replacement.ts'))
    await writeFile(join(directory, 'target.ts'), 'target\n')
    await symlink('target.ts', join(directory, 'replacement.ts'))

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'Symbolic links are not supported: replacement.ts',
    )
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

  test('normalizes a CRLF checkout to the committed content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nWorld\r\nAgain\r\n')
    await git(['add', 'greeting.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nUniverse\r\nAgain\r\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\nAgain\n',
        newContent: 'Hello\nUniverse\nAgain\n',
      },
    ])
  })

  test('normalizes a CRLF checkout that was edited with LF endings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nWorld\r\nAgain\r\n')
    await git(['add', 'greeting.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'Hello\nUniverse\nAgain\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\nAgain\n',
        newContent: 'Hello\nUniverse\nAgain\n',
      },
    ])
  })

  test('captures renames, deletions, and untracked files in a CRLF checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'old-name.ts'), 'one\r\ntwo\r\n')
    await writeFile(join(directory, 'deleted.ts'), 'gone\r\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await rename(join(directory, 'old-name.ts'), join(directory, 'new-name.ts'))
    await unlink(join(directory, 'deleted.ts'))
    await git(['add', '-A'], directory)
    await writeFile(join(directory, 'untracked.ts'), 'fresh\r\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'deleted.ts',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'gone\n',
        newContent: '',
      },
      {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'one\ntwo\n',
        newContent: 'one\ntwo\n',
      },
      {
        path: 'untracked.ts',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: 'fresh\n',
      },
    ])
  })

  test('keeps LF working-tree content unchanged when there is no conversion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\nWorld\nAgain\n')
    await git(['add', 'greeting.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'Hello\nUniverse\nAgain\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\nAgain\n',
        newContent: 'Hello\nUniverse\nAgain\n',
      },
    ])
  })

  test('normalizes a CRLF checkout when an executable bit is added', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\r\necho old\r\n')
    await git(['add', 'script.sh'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\r\necho new\r\n')
    await chmod(join(directory, 'script.sh'), 0o755)

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'script.sh',
        status: 'modified',
        oldMode: '100644',
        newMode: '100755',
        oldContent: '#!/bin/sh\necho old\n',
        newContent: '#!/bin/sh\necho new\n',
      },
    ])
  })

  test('reads CRLF content from the working tree when the index differs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nWorld\r\n')
    await git(['add', 'greeting.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nStaged\r\n')
    await git(['add', 'greeting.ts'], directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nWorktree\r\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\n',
        newContent: 'Hello\nWorktree\n',
      },
    ])
  })

  test('normalizes an added CRLF file staged in the index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'tracked.ts'), 'tracked\n')
    await git(['add', 'tracked.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'added.ts'), 'first\r\nsecond\r\n')
    await git(['add', 'added.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'added.ts',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: 'first\nsecond\n',
      },
    ])
  })

  test('rejects a binary edit in a CRLF checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'data.dat'), 'text\r\n')
    await git(['add', 'data.dat'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'data.dat'), new Uint8Array([0, 1, 2]))

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'Binary files are not supported: data.dat',
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
      {
        path: 'tracked.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'one\n',
        newContent: 'two\n',
      },
      {
        path: 'untracked.ts',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: 'ignore\n',
      },
    ])
  })

  test('captures executable additions and deletions between committed revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'deleted.sh'), '#!/bin/sh\necho deleted\n')
    await chmod(join(directory, 'deleted.sh'), 0o755)
    await git(['add', 'deleted.sh'], directory)
    await git(['commit', '-q', '-m', 'one'], directory)
    const first = (await gitText(['rev-parse', 'HEAD'], directory)).trim()

    await unlink(join(directory, 'deleted.sh'))
    await writeFile(join(directory, 'added.sh'), '#!/bin/sh\necho added\n')
    await chmod(join(directory, 'added.sh'), 0o755)
    await git(['add', '-A'], directory)
    await git(['commit', '-q', '-m', 'two'], directory)

    const capture = await captureGitRevisionChanges(first, 'HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'added.sh',
        status: 'added',
        oldMode: '000000',
        newMode: '100755',
        oldContent: '',
        newContent: '#!/bin/sh\necho added\n',
      },
      {
        path: 'deleted.sh',
        status: 'deleted',
        oldMode: '100755',
        newMode: '000000',
        oldContent: '#!/bin/sh\necho deleted\n',
        newContent: '',
      },
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
