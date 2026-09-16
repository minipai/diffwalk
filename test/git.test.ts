import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureGitChanges, captureGitRevisionChanges, gitUserName } from '../src/authoring/git'

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

  test('captures a binary replacement after a staged deletion with both side identities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'replacement.dat'), 'text\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['rm', '--cached', '-q', 'replacement.dat'], directory)
    await writeFile(join(directory, 'replacement.dat'), new Uint8Array([0, 1, 2]))

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'replacement.dat',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'text\n',
        newContent: '',
        newBinary: { size: 3, hash: sha256(new Uint8Array([0, 1, 2])) },
      },
    ])
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

  test('captures a binary edit in a CRLF checkout as a text-to-binary change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'data.dat'), 'text\r\n')
    await git(['add', 'data.dat'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'data.dat'), new Uint8Array([0, 1, 2]))

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'data.dat',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'text\n',
        newContent: '',
        newBinary: { size: 3, hash: sha256(new Uint8Array([0, 1, 2])) },
      },
    ])
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

describe('captureGitChanges selection', () => {
  test('captures only staged changes from the index, ignoring the working tree and untracked files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'staged\n')
    await git(['add', 'tracked.ts'], directory)
    await writeFile(join(directory, 'tracked.ts'), 'working tree\n')
    await writeFile(join(directory, 'untracked.ts'), 'untracked\n')

    const capture = await captureGitChanges('HEAD', directory, { staged: true })

    expect(capture.files).toEqual([
      {
        path: 'tracked.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'old\n',
        newContent: 'staged\n',
      },
    ])
  })

  test('captures staged additions and deletions from the index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'deleted.ts'), 'delete me\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['rm', '-q', 'deleted.ts'], directory)
    await writeFile(join(directory, 'added.ts'), 'added\n')
    await git(['add', 'added.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { staged: true })

    expect(capture.files).toEqual([
      {
        path: 'added.ts',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: 'added\n',
      },
      {
        path: 'deleted.ts',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'delete me\n',
        newContent: '',
      },
    ])
  })

  test('normalizes a staged CRLF edit to the index content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'core.autocrlf', 'true'], directory)
    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nWorld\r\n')
    await git(['add', 'greeting.ts'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'Hello\r\nUniverse\r\n')
    await git(['add', 'greeting.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { staged: true })

    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\n',
        newContent: 'Hello\nUniverse\n',
      },
    ])
  })

  test('limits a working-tree capture to the named paths, including untracked files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await writeFile(join(directory, 'keep.ts'), 'keep\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'new\n')
    await writeFile(join(directory, 'keep.ts'), 'changed\n')
    await writeFile(join(directory, 'untracked.ts'), 'untracked\n')
    await writeFile(join(directory, 'other.ts'), 'other\n')

    const capture = await captureGitChanges('HEAD', directory, {
      paths: ['tracked.ts', 'untracked.ts'],
    })

    expect(capture.files.map((file) => file.path)).toEqual(['tracked.ts', 'untracked.ts'])
    expect(capture.files[0]).toMatchObject({ status: 'modified', newContent: 'new\n' })
    expect(capture.files[1]).toMatchObject({ status: 'added', newContent: 'untracked\n' })
  })

  test('limits a staged capture to the named paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'first.ts'), 'first old\n')
    await writeFile(join(directory, 'second.ts'), 'second old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'first.ts'), 'first new\n')
    await writeFile(join(directory, 'second.ts'), 'second new\n')
    await git(['add', '.'], directory)

    const capture = await captureGitChanges('HEAD', directory, {
      staged: true,
      paths: ['first.ts'],
    })

    expect(capture.files).toEqual([
      {
        path: 'first.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'first old\n',
        newContent: 'first new\n',
      },
    ])
  })

  test('treats literal --path values literally instead of applying Git pathspec magic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'greeting.ts'), 'greeting old\n')
    await writeFile(join(directory, 'other.ts'), 'other old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'greeting.ts'), 'greeting new\n')
    await writeFile(join(directory, 'other.ts'), 'other new\n')

    const capture = await captureGitChanges('HEAD', directory, {
      paths: [':(exclude)greeting.ts'],
    })

    expect(capture.files).toEqual([])
  })

  test('excludes named files and directories from a working-tree capture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await writeFile(join(directory, 'experiments', 'inside.ts'), 'inside old\n')
    await writeFile(join(directory, 'experiments.ts'), 'sibling old\n')
    await writeFile(join(directory, 'notes.md'), 'notes old\n')
    await writeFile(join(directory, 'kept.ts'), 'kept old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'experiments', 'inside.ts'), 'inside new\n')
    await writeFile(join(directory, 'experiments.ts'), 'sibling new\n')
    await writeFile(join(directory, 'notes.md'), 'notes new\n')
    await writeFile(join(directory, 'kept.ts'), 'kept new\n')
    await writeFile(join(directory, 'experiments', 'untracked.ts'), 'untracked\n')

    const capture = await captureGitChanges('HEAD', directory, {
      exclude: ['experiments', 'notes.md'],
    })

    // `experiments` excludes the tracked directory contents and its untracked file, but
    // not the sibling `experiments.ts`: the match is literal, on path boundaries.
    expect(capture.files.map((file) => file.path)).toEqual(['experiments.ts', 'kept.ts'])
  })

  test('applies exclusions after positive paths so an exclusion always wins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src', 'nested'), { recursive: true })
    await writeFile(join(directory, 'src', 'a.ts'), 'a old\n')
    await writeFile(join(directory, 'src', 'skip.ts'), 'skip old\n')
    await writeFile(join(directory, 'src', 'nested', 'deep.ts'), 'deep old\n')
    await writeFile(join(directory, 'other.ts'), 'other old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'src', 'a.ts'), 'a new\n')
    await writeFile(join(directory, 'src', 'skip.ts'), 'skip new\n')
    await writeFile(join(directory, 'src', 'nested', 'deep.ts'), 'deep new\n')
    await writeFile(join(directory, 'other.ts'), 'other new\n')

    const capture = await captureGitChanges('HEAD', directory, {
      paths: ['src', 'other.ts'],
      exclude: ['src/skip.ts', 'src/nested'],
    })

    expect(capture.files.map((file) => file.path)).toEqual(['other.ts', 'src/a.ts'])
  })

  test('preserves a rename into an excluded directory as a move with both paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await writeFile(join(directory, 'experiments', 'kept.ts'), 'kept\n')
    await writeFile(join(directory, 'moved.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'moved.ts', 'experiments/moved.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { exclude: ['experiments'] })

    // Git detects the rename before the exclusion drops the destination, so the in-scope old
    // side keeps the move instead of degrading to a deletion.
    expect(capture.files).toEqual([
      {
        path: 'moved.ts',
        excludedPath: 'experiments/moved.ts',
        status: 'moved-to-excluded',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })

  test('preserves a rename out of an excluded directory as a move with both paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await writeFile(join(directory, 'experiments', 'moved.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'experiments/moved.ts', 'back.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { exclude: ['experiments'] })

    expect(capture.files).toEqual([
      {
        path: 'back.ts',
        excludedPath: 'experiments/moved.ts',
        status: 'moved-from-excluded',
        oldMode: '100644',
        newMode: '100644',
        oldContent: '',
        newContent: 'same\n',
      },
    ])
  })

  test('omits a rename whose both sides are excluded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await writeFile(join(directory, 'experiments', 'inside.ts'), 'inside\n')
    await writeFile(join(directory, 'kept.ts'), 'kept\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'experiments/inside.ts', 'experiments/renamed.ts'], directory)
    await writeFile(join(directory, 'kept.ts'), 'kept changed\n')

    const capture = await captureGitChanges('HEAD', directory, { exclude: ['experiments'] })

    // The rename lives entirely inside the excluded directory, so the whole move is omitted
    // and only the unrelated modification remains.
    expect(capture.files.map((file) => file.path)).toEqual(['kept.ts'])
  })

  test('keeps a rename with neither side excluded as a normal rename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'kept-old.ts'), 'kept\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'kept-old.ts', 'kept-new.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { exclude: ['experiments'] })

    expect(capture.files).toEqual([
      {
        path: 'kept-new.ts',
        oldPath: 'kept-old.ts',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'kept\n',
        newContent: 'kept\n',
      },
    ])
  })

  test('preserves a staged rename crossing an exclusion with only the index side read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await writeFile(join(directory, 'moved.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'moved.ts', 'experiments/moved.ts'], directory)
    await git(['add', '-A'], directory)

    const capture = await captureGitChanges('HEAD', directory, {
      staged: true,
      exclude: ['experiments'],
    })

    expect(capture.files).toEqual([
      {
        path: 'moved.ts',
        excludedPath: 'experiments/moved.ts',
        status: 'moved-to-excluded',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })

  test('loses a rename that crosses the initial positive path scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'old.ts'), 'same\n')
    await writeFile(join(directory, 'other.ts'), 'other\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'old.ts', 'new.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { paths: ['old.ts'] })

    // Git resolves the positive pathspec before it pairs renames, so the destination outside
    // the scope leaves the in-scope source looking like a deletion. Only `--exclude` keeps
    // detected moves; this limitation is documented.
    expect(capture.files).toEqual([
      {
        path: 'old.ts',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })

  test('does not read or reject unsupported files that an exclusion omits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'experiments'))
    await symlink('one', join(directory, 'experiments', 'link'))
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\n')
    await writeFile(join(directory, 'kept.ts'), 'kept old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await unlink(join(directory, 'experiments', 'link'))
    await symlink('two', join(directory, 'experiments', 'link'))
    await chmod(join(directory, 'script.sh'), 0o755)
    await writeFile(join(directory, 'kept.ts'), 'kept new\n')

    // Both the symlink (unsupported type) and the mode-only change are outside the
    // requested scope, so they must not be read or validated.
    const capture = await captureGitChanges('HEAD', directory, {
      exclude: ['experiments', 'script.sh'],
    })

    expect(capture.files.map((file) => file.path)).toEqual(['kept.ts'])
    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow('Unsupported Git file type')
  })

  test('treats exclusion paths literally, including special characters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    for (const name of ['star*file.ts', 'starXfile.ts', 'q?mark.ts', 'brack[et].ts', 'sp ace.ts']) {
      await writeFile(join(directory, name), `${name} old\n`)
    }
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    for (const name of ['star*file.ts', 'starXfile.ts', 'q?mark.ts', 'brack[et].ts', 'sp ace.ts']) {
      await writeFile(join(directory, name), `${name} new\n`)
    }

    const capture = await captureGitChanges('HEAD', directory, {
      exclude: ['star*file.ts', 'q?mark.ts', 'brack[et].ts', 'sp ace.ts'],
    })

    // `star*file.ts` excludes only that literal name, so the glob-similar `starXfile.ts` stays.
    expect(capture.files.map((file) => file.path)).toEqual(['starXfile.ts'])
  })

  test('applies an exclusion to a staged capture, including a spaced filename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'sp ace.ts'), 'old\n')
    await writeFile(join(directory, 'kept.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'sp ace.ts'), 'new\n')
    await writeFile(join(directory, 'kept.ts'), 'new\n')
    await git(['add', '.'], directory)

    const capture = await captureGitChanges('HEAD', directory, {
      staged: true,
      exclude: ['sp ace.ts'],
    })

    expect(capture.files.map((file) => file.path)).toEqual(['kept.ts'])
  })

  test('returns an empty capture when every change is excluded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'new\n')
    await writeFile(join(directory, 'untracked.ts'), 'untracked\n')

    const capture = await captureGitChanges('HEAD', directory, { exclude: ['.'] })

    expect(capture.files).toEqual([])
  })

  test('captures a staged rename with both sides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'old-name.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await git(['mv', 'old-name.ts', 'new-name.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { staged: true })

    expect(capture.files).toEqual([
      {
        path: 'new-name.ts',
        oldPath: 'old-name.ts',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'same\n',
        newContent: 'same\n',
      },
    ])
  })

  test('rejects a staged mode-only change that has no representable block', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'script.sh'), '#!/bin/sh\n')
    await git(['add', 'script.sh'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await chmod(join(directory, 'script.sh'), 0o755)
    await git(['add', 'script.sh'], directory)

    await expect(captureGitChanges('HEAD', directory, { staged: true })).rejects.toThrow(
      'File mode changes are not supported: script.sh',
    )
  })
})

describe('captureGitChanges pathspec selection', () => {
  test('selects tracked and untracked files with a Git glob pathspec', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src', 'nested'), { recursive: true })
    await writeFile(join(directory, 'src', 'a.ts'), 'a old\n')
    await writeFile(join(directory, 'src', 'nested', 'deep.ts'), 'deep old\n')
    await writeFile(join(directory, 'other.md'), 'other old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'src', 'a.ts'), 'a new\n')
    await writeFile(join(directory, 'src', 'nested', 'deep.ts'), 'deep new\n')
    await writeFile(join(directory, 'src', 'untracked.ts'), 'untracked\n')
    await writeFile(join(directory, 'other.md'), 'other new\n')

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(glob)src/**/*.ts'],
    })

    expect(capture.files.map((file) => file.path)).toEqual([
      'src/a.ts',
      'src/nested/deep.ts',
      'src/untracked.ts',
    ])
  })

  test('selects everything except an excluded pathspec, tracked and untracked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'tracked old\n')
    await writeFile(join(directory, 'notes.md'), 'notes old\n')
    await writeFile(join(directory, 'pnpm-lock.yaml'), 'lock old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'tracked new\n')
    await writeFile(join(directory, 'notes.md'), 'notes new\n')
    await writeFile(join(directory, 'pnpm-lock.yaml'), 'lock new\n')
    await writeFile(join(directory, 'untracked.ts'), 'untracked\n')

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(exclude)pnpm-lock.yaml'],
    })

    expect(capture.files.map((file) => file.path)).toEqual([
      'notes.md',
      'tracked.ts',
      'untracked.ts',
    ])
  })

  test('combines a positive glob with exclusion magic in one scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src', 'legacy'), { recursive: true })
    await writeFile(join(directory, 'src', 'a.ts'), 'a old\n')
    await writeFile(join(directory, 'src', 'legacy', 'b.ts'), 'b old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'src', 'a.ts'), 'a new\n')
    await writeFile(join(directory, 'src', 'legacy', 'b.ts'), 'b new\n')

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(glob)src/**/*.ts', ':(exclude)src/legacy'],
    })

    expect(capture.files.map((file) => file.path)).toEqual(['src/a.ts'])
  })

  test('selects a whole directory with a plain pathspec, including untracked files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src'))
    await writeFile(join(directory, 'src', 'a.ts'), 'a old\n')
    await writeFile(join(directory, 'other.ts'), 'other old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'src', 'a.ts'), 'a new\n')
    await writeFile(join(directory, 'src', 'untracked.ts'), 'untracked\n')
    await writeFile(join(directory, 'other.ts'), 'other new\n')

    const capture = await captureGitChanges('HEAD', directory, { pathspecs: ['src'] })

    expect(capture.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/untracked.ts'])
  })

  test('returns an empty capture when a pathspec matches nothing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'new\n')

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(glob)missing/**'],
    })

    expect(capture.files).toEqual([])
  })

  test('rejects an invalid pathspec expression with the Git error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'tracked.ts'), 'old\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'tracked.ts'), 'new\n')

    await expect(
      captureGitChanges('HEAD', directory, { pathspecs: [':(bogus)x'] }),
    ).rejects.toThrow(/pathspec magic/i)
  })

  test('loses a rename that leaves a positive pathspec scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src'))
    await writeFile(join(directory, 'src', 'old.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await mkdir(join(directory, 'dest'))
    await git(['mv', 'src/old.ts', 'dest/new.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, { pathspecs: ['src'] })

    // Git resolves the scope before it pairs renames, so the destination outside the
    // pathspec leaves the in-scope source looking like a deletion.
    expect(capture.files).toEqual([
      {
        path: 'src/old.ts',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })

  test('loses a rename whose destination an exclusion pathspec drops early', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeFile(join(directory, 'moved.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await mkdir(join(directory, 'experiments'))
    await git(['mv', 'moved.ts', 'experiments/moved.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(exclude)experiments'],
    })

    expect(capture.files).toEqual([
      {
        path: 'moved.ts',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })

  test('keeps a rename crossing a later literal --exclude when both sides pass the pathspec', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await mkdir(join(directory, 'src'))
    await writeFile(join(directory, 'src', 'moved.ts'), 'same\n')
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await mkdir(join(directory, 'src', 'experiments'))
    await git(['mv', 'src/moved.ts', 'src/experiments/moved.ts'], directory)

    const capture = await captureGitChanges('HEAD', directory, {
      pathspecs: [':(glob)src/**/*.ts'],
      exclude: ['src/experiments'],
    })

    // Both sides survive the initial glob scope, so Git pairs the rename and the later
    // literal exclusion preserves the move with both paths.
    expect(capture.files).toEqual([
      {
        path: 'src/moved.ts',
        excludedPath: 'src/experiments/moved.ts',
        status: 'moved-to-excluded',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'same\n',
        newContent: '',
      },
    ])
  })
})

describe('binary capture', () => {
  test('captures binary additions, modifications, deletions, and renames in the working tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeBinary(directory, 'old.bin', [0, 1, 2, 3])
    await writeBinary(directory, 'delete.bin', [0, 9])
    await writeBinary(directory, 'rename.bin', [0, 5, 5])
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeBinary(directory, 'old.bin', [0, 1, 2, 3, 4])
    await unlink(join(directory, 'delete.bin'))
    await unlink(join(directory, 'rename.bin'))
    await writeBinary(directory, 'moved.bin', [0, 5, 5])
    await writeBinary(directory, 'new.bin', [0, 7, 7, 7])
    await git(['add', '-A'], directory)

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'delete.bin',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: '',
        newContent: '',
        oldBinary: { size: 2, hash: sha256(new Uint8Array([0, 9])) },
      },
      {
        path: 'moved.bin',
        oldPath: 'rename.bin',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: '',
        newContent: '',
        oldBinary: { size: 3, hash: sha256(new Uint8Array([0, 5, 5])) },
        newBinary: { size: 3, hash: sha256(new Uint8Array([0, 5, 5])) },
      },
      {
        path: 'new.bin',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: '',
        newBinary: { size: 4, hash: sha256(new Uint8Array([0, 7, 7, 7])) },
      },
      {
        path: 'old.bin',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: '',
        newContent: '',
        oldBinary: { size: 4, hash: sha256(new Uint8Array([0, 1, 2, 3])) },
        newBinary: { size: 5, hash: sha256(new Uint8Array([0, 1, 2, 3, 4])) },
      },
    ])
  })

  test('captures a binary-to-text transition with the identity of both sides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeBinary(directory, 'transition.dat', [0, 1, 2])
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await writeFile(join(directory, 'transition.dat'), 'plain text\n')

    const capture = await captureGitChanges('HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'transition.dat',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: '',
        newContent: 'plain text\n',
        oldBinary: { size: 3, hash: sha256(new Uint8Array([0, 1, 2])) },
      },
    ])
  })

  test('captures binary additions and deletions between committed revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeBinary(directory, 'gone.bin', [0, 3, 3])
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'one'], directory)
    const first = (await gitText(['rev-parse', 'HEAD'], directory)).trim()

    await unlink(join(directory, 'gone.bin'))
    await writeBinary(directory, 'fresh.bin', [0, 4])
    await git(['add', '-A'], directory)
    await git(['commit', '-q', '-m', 'two'], directory)

    const capture = await captureGitRevisionChanges(first, 'HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'fresh.bin',
        status: 'added',
        oldMode: '000000',
        newMode: '100644',
        oldContent: '',
        newContent: '',
        newBinary: { size: 2, hash: sha256(new Uint8Array([0, 4])) },
      },
      {
        path: 'gone.bin',
        status: 'deleted',
        oldMode: '100644',
        newMode: '000000',
        oldContent: '',
        newContent: '',
        oldBinary: { size: 3, hash: sha256(new Uint8Array([0, 3, 3])) },
      },
    ])
  })

  test('captures a binary rename between committed revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeBinary(directory, 'before.bin', [0, 5, 5])
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'one'], directory)
    const first = (await gitText(['rev-parse', 'HEAD'], directory)).trim()

    await rename(join(directory, 'before.bin'), join(directory, 'after.bin'))
    await git(['add', '-A'], directory)
    await git(['commit', '-q', '-m', 'two'], directory)

    const capture = await captureGitRevisionChanges(first, 'HEAD', directory)

    expect(capture.files).toEqual([
      {
        path: 'after.bin',
        oldPath: 'before.bin',
        status: 'renamed',
        oldMode: '100644',
        newMode: '100644',
        oldContent: '',
        newContent: '',
        oldBinary: { size: 3, hash: sha256(new Uint8Array([0, 5, 5])) },
        newBinary: { size: 3, hash: sha256(new Uint8Array([0, 5, 5])) },
      },
    ])
  })

  test('rejects a mode-only change to a binary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await writeBinary(directory, 'script.bin', [0, 1])
    await git(['add', '.'], directory)
    await git(['commit', '-q', '-m', 'fixture'], directory)

    await chmod(join(directory, 'script.bin'), 0o755)

    await expect(captureGitChanges('HEAD', directory)).rejects.toThrow(
      'File mode changes are not supported: script.bin',
    )
  })
})

describe('gitUserName', () => {
  test('reads the configured Git user name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)

    expect(await gitUserName(directory)).toBe('Test')
  })

  test('returns undefined when Git has no user name to report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await initializeRepository(directory)
    await git(['config', 'user.name', ''], directory)

    expect(await gitUserName(directory)).toBeUndefined()
  })

  test('returns undefined instead of throwing when the config cannot be read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-git-'))
    directories.push(directory)
    await git(['init', '-q'], directory)
    const previous = {
      global: process.env['GIT_CONFIG_GLOBAL'],
      system: process.env['GIT_CONFIG_SYSTEM'],
    }
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null'
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null'
    try {
      expect(await gitUserName(directory)).toBeUndefined()
    } finally {
      for (const [key, value] of [
        ['GIT_CONFIG_GLOBAL', previous.global],
        ['GIT_CONFIG_SYSTEM', previous.system],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

async function initializeRepository(directory: string) {
  await git(['init', '-q'], directory)
  await git(['config', 'user.name', 'Test'], directory)
  await git(['config', 'user.email', 'test@example.com'], directory)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeBinary(directory: string, name: string, bytes: number[]) {
  await writeFile(join(directory, name), new Uint8Array(bytes))
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
