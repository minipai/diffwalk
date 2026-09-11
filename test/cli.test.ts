import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureIdFor } from '../src/authoring/capture'
import { captureSchema } from '../src/format'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const cliPath = join(import.meta.dir, '..', 'dist', 'diffwalk.js')

interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCli(
  args: string[],
  cwd: string,
  environment: Record<string, string> = {},
): Promise<CliResult> {
  const child = Bun.spawn(['node', cliPath, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...environment },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

function diffwalkDir(repo: string) {
  return join(repo, '.diffwalk')
}

async function readCurrentWalkId(repo: string) {
  return (await readFile(join(diffwalkDir(repo), 'current'), 'utf8')).trim()
}

async function currentWalkDir(repo: string) {
  return join(diffwalkDir(repo), await readCurrentWalkId(repo))
}

async function readCapture(repo: string) {
  return captureSchema.parse(
    JSON.parse(await readFile(join(await currentWalkDir(repo), 'capture.json'), 'utf8')),
  )
}

async function readExplanationsYaml(repo: string) {
  return readFile(join(await currentWalkDir(repo), 'explanations.yaml'), 'utf8')
}

async function writeExplanations(repo: string, yaml: string) {
  await writeFile(join(await currentWalkDir(repo), 'explanations.yaml'), yaml)
}

function everyChangeYaml(captureId: string, changes: { id: string }[]): string {
  return (
    `captureId: ${captureId}\n` +
    `title: A change set\n` +
    `sections:\n` +
    changes
      .map(
        (change, index) =>
          `  - title: Section ${index + 1}\n    steps:\n      - text: Text\n        changes:\n          - ${change.id}\n`,
      )
      .join('')
  )
}

async function authorEveryChange(repo: string) {
  const capture = await readCapture(repo)
  await writeExplanations(repo, everyChangeYaml(capture.captureId, capture.changes))
}

async function persistCurrentCaptureWithoutModes(repo: string) {
  const walk = await readCurrentWalkId(repo)
  const capturePath = join(await currentWalkDir(repo), 'capture.json')
  const capture = await readCapture(repo)
  const legacyId = captureIdFor(capture.files, false)
  const persisted = JSON.parse(await readFile(capturePath, 'utf8')) as {
    captureId: string
    files: Record<string, unknown>[]
    changes: { id: string }[]
  }
  persisted.captureId = legacyId
  for (const file of persisted.files) {
    delete file.oldMode
    delete file.newMode
  }
  await writeFile(capturePath, `${JSON.stringify(persisted, null, 2)}\n`)
  const explanations = everyChangeYaml(legacyId, persisted.changes)
  await writeExplanations(repo, explanations)
  return { walk, explanations }
}

async function fixtureRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
  directories.push(repo)
  await initializeRepository(repo)
  await writeFile(join(repo, 'greeting.ts'), 'Hello\nWorld\n')
  await writeFile(join(repo, 'keep.ts'), 'keep\n')
  await git(['add', '.'], repo)
  await git(['commit', '-q', '-m', 'fixture'], repo)
  await writeFile(join(repo, 'greeting.ts'), 'Hello\nUniverse\n')
  await writeFile(join(repo, 'untracked.ts'), 'untracked\n')
  return repo
}

async function committedFixtureRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
  directories.push(repo)
  await initializeRepository(repo)
  await writeFile(join(repo, 'committed.ts'), 'old\n')
  await git(['add', '.'], repo)
  await git(['commit', '-q', '-m', 'base'], repo)
  await writeFile(join(repo, 'committed.ts'), 'new\n')
  await git(['add', '.'], repo)
  await git(['commit', '-q', '-m', 'change'], repo)
  return repo
}

describe('help', () => {
  test('bare diffwalk, --help, and -h show CAC help', async () => {
    const repo = await fixtureRepo()
    for (const args of [[], ['--help'], ['-h']]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stdout).toContain('Commands:')
      expect(result.stdout).toContain('inspect')
      expect(result.stdout).toContain('check')
      expect(result.stdout).toContain('--help')
    }
  })

  test('--version and -v print the package version', async () => {
    const repo = await fixtureRepo()
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, '..', 'package.json'), 'utf8'),
    ) as { version: string }

    for (const args of [['--version'], ['-v']]) {
      const result = await runCli(args, repo)
      expect(result).toEqual({ exitCode: 0, stdout: `${packageJson.version}\n`, stderr: '' })
    }
  })

  test('command --help describes its usage and options', async () => {
    const repo = await fixtureRepo()
    for (const command of ['inspect', 'changes', 'change', 'file', 'check', 'view', 'export', 'publish', 'unpublish']) {
      const result = await runCli([command, '--help'], repo)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Usage: diffwalk ${command}`)
      expect(result.stdout).toContain('Options:')
    }
  })

  test('unknown commands and top-level options exit nonzero', async () => {
    const repo = await fixtureRepo()
    const command = await runCli(['bogus'], repo)
    expect(command.exitCode).not.toBe(0)
    expect(command.stderr).toContain('too many arguments')

    const option = await runCli(['--bogus'], repo)
    expect(option.exitCode).not.toBe(0)
    expect(option.stderr).toContain("unknown option '--bogus'")
  })
})

describe('usage errors', () => {
  test('unknown options and missing positionals exit nonzero with usage', async () => {
    const repo = await fixtureRepo()
    const cases: string[][] = [
      ['changes', '--bogus', 'x'],
      ['file', '--before'],
      ['change'],
      ['file', 'a.ts'],
      ['file', 'a.ts', '--before', '--after'],
      ['export'],
      ['export', 'pdf'],
      ['changes', 'stray-positional'],
    ]
    for (const args of cases) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  })

  test('command --help exits 0 and does not run the command', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['inspect', '--help'], repo)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: diffwalk inspect [options] [revision]')
  })

  test('rejects malformed and dot-nested options', async () => {
    const repo = await fixtureRepo()
    for (const args of [
      ['inspect', '--bogus'],
      ['changes', '--input'],
      ['changes', '--input='],
      ['changes', '--input', '--input', 'capture.json'],
      ['inspect', '--from.foo', 'HEAD^1', '--to.foo', 'HEAD'],
    ]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  })
})

describe('inspect', () => {
  test('writes capture.json and an explanations.yaml skeleton, then tells the next steps', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Captured')
    expect(result.stdout).toContain('change blocks across')
    expect(result.stdout).toMatch(/\.diffwalk\/\d{8}T\d{6}Z-[0-9a-f]{8}\/capture\.json/)
    expect(result.stdout).toMatch(/Wrote a \.diffwalk\/.+\/explanations\.yaml skeleton/)
    expect(result.stdout).toMatch(/Next: edit \.diffwalk\/.+\/explanations\.yaml/)

    const capture = await readCapture(repo)
    const walkId = await readCurrentWalkId(repo)
    expect(walkId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
    expect(walkId.endsWith(capture.captureId.slice(0, 8))).toBe(true)
    expect(capture.captureId).toMatch(/^[0-9a-f]{64}$/)
    expect(capture.files.map((file) => file.path)).toEqual(['greeting.ts', 'untracked.ts'])
    expect(capture.changes.length).toBeGreaterThan(0)
    expect(capture).not.toHaveProperty('sections')

    const yaml = await readExplanationsYaml(repo)
    expect(yaml).toContain(`captureId: ${capture.captureId}`)
    expect(yaml).toContain('title: Name this change set')
    expect(yaml).toContain('sections: []')
  })

  test('captures a one-line edit in a CRLF checkout as one change block', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await git(['config', 'core.autocrlf', 'true'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\r\nWorld\r\nAgain\r\n')
    await git(['add', 'greeting.ts'], repo)
    await git(['commit', '-q', '-m', 'fixture'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\r\nUniverse\r\nAgain\r\n')

    const inspect = await runCli(['inspect'], repo)
    expect(inspect.exitCode).toBe(0)

    const changes = await runCli(['changes', '--json'], repo)
    expect(changes.exitCode).toBe(0)
    const data = JSON.parse(changes.stdout) as {
      changes: { before: string; after: string; oldStart: number; newStart: number }[]
    }
    expect(data.changes).toHaveLength(1)
    expect(data.changes[0]).toMatchObject({
      before: 'World\n',
      after: 'Universe\n',
      oldStart: 2,
      newStart: 2,
    })

    const capture = await readCapture(repo)
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

  test('captures a one-line LF edit in a CRLF checkout as one change block', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await git(['config', 'core.autocrlf', 'true'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\r\nWorld\r\nAgain\r\n')
    await git(['add', 'greeting.ts'], repo)
    await git(['commit', '-q', '-m', 'fixture'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nUniverse\nAgain\n')

    const inspect = await runCli(['inspect'], repo)
    expect(inspect.exitCode).toBe(0)

    const changes = await runCli(['changes', '--json'], repo)
    expect(changes.exitCode).toBe(0)
    const data = JSON.parse(changes.stdout) as {
      changes: { before: string; after: string; oldStart: number; newStart: number }[]
    }
    expect(data.changes).toHaveLength(1)
    expect(data.changes[0]).toMatchObject({
      before: 'World\n',
      after: 'Universe\n',
      oldStart: 2,
      newStart: 2,
    })
  })

  test('captures a one-line edit in an LF checkout as one change block', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nWorld\nAgain\n')
    await git(['add', 'greeting.ts'], repo)
    await git(['commit', '-q', '-m', 'fixture'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nUniverse\nAgain\n')

    const inspect = await runCli(['inspect'], repo)
    expect(inspect.exitCode).toBe(0)

    const changes = await runCli(['changes', '--json'], repo)
    expect(changes.exitCode).toBe(0)
    const data = JSON.parse(changes.stdout) as {
      changes: { before: string; after: string; oldStart: number; newStart: number }[]
    }
    expect(data.changes).toHaveLength(1)
    expect(data.changes[0]).toMatchObject({
      before: 'World\n',
      after: 'Universe\n',
      oldStart: 2,
      newStart: 2,
    })
  })

  test('never overwrites an authored explanations.yaml', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await writeExplanations(repo, '# my authored file\ncaptureId: stale\ntitle: Mine\nsections: []\n')

    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Kept existing .diffwalk/')
    expect(result.stdout).toContain('Working tree is unchanged; kept current walk')
    expect(await readExplanationsYaml(repo)).toBe(
      '# my authored file\ncaptureId: stale\ntitle: Mine\nsections: []\n',
    )
  })

  test('reuses a mode-less persisted capture and its authored explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const { walk, explanations } = await persistCurrentCaptureWithoutModes(repo)

    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Working tree is unchanged; kept current walk')
    expect(await readCurrentWalkId(repo)).toBe(walk)
    expect(await readExplanationsYaml(repo)).toBe(explanations)
    expect((await runCli(['check'], repo)).exitCode).toBe(0)
  })

  test('does not reuse a legacy executable capture after its mode changes', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await writeFile(join(repo, 'script.sh'), '#!/bin/sh\necho old\n')
    await chmod(join(repo, 'script.sh'), 0o755)
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'fixture'], repo)
    await writeFile(join(repo, 'script.sh'), '#!/bin/sh\necho new\n')
    await runCli(['inspect'], repo)
    const { walk: legacyWalk, explanations } = await persistCurrentCaptureWithoutModes(repo)

    await chmod(join(repo, 'script.sh'), 0o644)
    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(await readCurrentWalkId(repo)).not.toBe(legacyWalk)
    expect(await readFile(join(diffwalkDir(repo), legacyWalk, 'explanations.yaml'), 'utf8')).toBe(
      explanations,
    )
    expect((await readCapture(repo)).files[0]).toEqual(
      expect.objectContaining({ oldMode: '100755', newMode: '100644' }),
    )
  })

  test('creates a new current walk on content change and preserves the earlier authoring pair', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const first = await readCapture(repo)
    const firstWalk = await readCurrentWalkId(repo)
    await authorEveryChange(repo)
    const firstExplanations = await readExplanationsYaml(repo)

    await writeFile(join(repo, 'greeting.ts'), 'Hello\nGalaxy\n')
    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    const second = await readCapture(repo)
    const secondWalk = await readCurrentWalkId(repo)
    expect(second.captureId).not.toBe(first.captureId)
    expect(secondWalk).not.toBe(firstWalk)
    expect(await readFile(join(diffwalkDir(repo), firstWalk, 'explanations.yaml'), 'utf8')).toBe(
      firstExplanations,
    )
    expect(await readExplanationsYaml(repo)).toContain(`captureId: ${second.captureId}`)
  })

  test('prints a directly usable check command for custom paths', async () => {
    const repo = await fixtureRepo()
    const capturePath = 'out/capture.json'
    const explanationsPath = 'out/explanations.yaml'

    const inspect = await runCli(
      ['inspect', '--output', capturePath, '--explanations', explanationsPath],
      repo,
    )

    expect(inspect.exitCode).toBe(0)
    expect(inspect.stdout).toContain(
      `Next: edit ${explanationsPath}, then run \`diffwalk check --input ${capturePath} --explanations ${explanationsPath}\`.`,
    )
    expect(inspect.stdout).not.toContain('run `diffwalk check`.')
    expect(inspect.stdout).not.toContain('.diffwalk/')

    const bare = await runCli(['check'], repo)
    expect(bare.exitCode).not.toBe(0)
    expect(bare.stderr).toContain('No current Diffwalk capture')

    const capture = JSON.parse(await readFile(join(repo, capturePath), 'utf8')) as {
      captureId: string
      changes: { id: string }[]
    }
    await writeFile(
      join(repo, explanationsPath),
      everyChangeYaml(capture.captureId, capture.changes),
    )

    const check = await runCli(
      ['check', '--input', capturePath, '--explanations', explanationsPath],
      repo,
    )
    expect(check.exitCode).toBe(0)
    expect(check.stdout).toContain('OK:')
  })

  test('pairs a custom capture path with explanations in the same directory', async () => {
    const repo = await fixtureRepo()

    const inspect = await runCli(['inspect', '--output', 'out/capture.json'], repo)

    expect(inspect.exitCode).toBe(0)
    expect(inspect.stdout).toContain(
      'Next: edit out/explanations.yaml, then run `diffwalk check --input out/capture.json --explanations out/explanations.yaml`.',
    )
  })

  test('preserves numeric-looking option values as strings', async () => {
    const repo = await fixtureRepo()

    const inspect = await runCli(['inspect', '--output', '001'], repo)

    expect(inspect.exitCode).toBe(0)
    expect(inspect.stdout).toContain('files to 001')
    expect(await readFile(join(repo, '001'), 'utf8')).toContain('"captureId"')
  })

  test('preserves equals signs in inline option values', async () => {
    const repo = await fixtureRepo()

    const inspect = await runCli(['inspect', '--output=foo=bar'], repo)

    expect(inspect.exitCode).toBe(0)
    expect(inspect.stdout).toContain('files to foo=bar')
    expect(await readFile(join(repo, 'foo=bar'), 'utf8')).toContain('"captureId"')
  })

  test('captures a commit relative to its first parent', async () => {
    const repo = await committedFixtureRepo()
    const result = await runCli(['inspect', 'HEAD'], repo)

    expect(result.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.source.kind).toBe('commit-diff')
    if (capture.source.kind !== 'commit-diff') throw new Error('expected commit source')
    expect(capture.source.from.revision).toBe('HEAD^1')
    expect(capture.source.to.revision).toBe('HEAD')
    expect(capture.source.from.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(capture.source.to.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(capture.files).toEqual([
      {
        path: 'committed.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
    ])
  })

  test('captures an explicit committed range and rejects incomplete or conflicting forms', async () => {
    const repo = await committedFixtureRepo()
    const valid = await runCli(['inspect', '--from', 'HEAD^1', '--to', 'HEAD'], repo)
    expect(valid.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.source.kind).toBe('commit-diff')

    for (const args of [
      ['inspect', '--from', 'HEAD'],
      ['inspect', '--to', 'HEAD'],
      ['inspect', 'HEAD', '--base', 'HEAD^1'],
      ['inspect', '--from', 'HEAD^1', '--to', 'HEAD', 'extra'],
    ]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  })

  test('captures a merge commit relative to its first parent', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await writeFile(join(repo, 'base.ts'), 'base\n')
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'base'], repo)

    await git(['checkout', '-q', '-b', 'side'], repo)
    await writeFile(join(repo, 'second-parent.ts'), 'second parent\n')
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'second parent'], repo)

    await git(['checkout', '-q', '-b', 'first-parent', 'HEAD^'], repo)
    await writeFile(join(repo, 'first-parent.ts'), 'first parent\n')
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'first parent'], repo)
    await git(['merge', '--no-ff', '-q', 'side', '-m', 'merge'], repo)

    const result = await runCli(['inspect', 'HEAD'], repo)

    expect(result.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.files.map((file) => file.path)).toEqual(['second-parent.ts'])
    expect(capture.files).not.toContainEqual(expect.objectContaining({ path: 'first-parent.ts' }))
  })

  test('rejects a root commit in positional form', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await writeFile(join(repo, 'root.ts'), 'root\n')
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'root'], repo)

    const result = await runCli(['inspect', 'HEAD'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('root commit')
    expect(result.stderr).toContain('--from')
  })

  test('--staged captures the index instead of the working tree and skips untracked files', async () => {
    const repo = await fixtureRepo()
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nIndexed\n')
    await git(['add', 'greeting.ts'], repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nWorking tree\n')

    const result = await runCli(['inspect', '--staged'], repo)

    expect(result.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.files).toEqual([
      {
        path: 'greeting.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
        oldContent: 'Hello\nWorld\n',
        newContent: 'Hello\nIndexed\n',
      },
    ])
  })

  test('limits a working-tree capture to the paths after --', async () => {
    const repo = await fixtureRepo()

    const result = await runCli(['inspect', '--', 'untracked.ts'], repo)

    expect(result.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.files.map((file) => file.path)).toEqual(['untracked.ts'])
    expect(capture.changes.length).toBeGreaterThan(0)
  })

  test('captures multiple paths and treats an option-like path literally', async () => {
    const repo = await fixtureRepo()

    const multiple = await runCli(['inspect', '--', 'greeting.ts', 'untracked.ts'], repo)
    expect(multiple.exitCode).toBe(0)
    expect((await readCapture(repo)).files.map((file) => file.path)).toEqual([
      'greeting.ts',
      'untracked.ts',
    ])

    await writeFile(join(repo, '--staged'), 'content\n')
    const optionLike = await runCli(['inspect', '--', '--staged'], repo)
    expect(optionLike.exitCode).toBe(0)
    expect((await readCapture(repo)).files.map((file) => file.path)).toEqual(['--staged'])
  })

  test('combines --staged with explicit paths', async () => {
    const repo = await fixtureRepo()
    await git(['add', 'greeting.ts'], repo)

    const result = await runCli(['inspect', '--staged', '--', 'greeting.ts'], repo)

    expect(result.exitCode).toBe(0)
    const capture = await readCapture(repo)
    expect(capture.files.map((file) => file.path)).toEqual(['greeting.ts'])
  })

  test('a path-limited capture keeps a deterministic identity and passes check', async () => {
    const repo = await fixtureRepo()

    const first = await runCli(['inspect', '--', 'greeting.ts'], repo)
    expect(first.exitCode).toBe(0)
    const walk = await readCurrentWalkId(repo)
    const capture = await readCapture(repo)

    const second = await runCli(['inspect', '--', 'greeting.ts'], repo)
    expect(second.exitCode).toBe(0)
    expect(second.stdout).toContain('Working tree is unchanged; kept current walk')
    expect(await readCurrentWalkId(repo)).toBe(walk)

    await authorEveryChange(repo)
    const check = await runCli(['check'], repo)
    expect(check.exitCode).toBe(0)
    expect(check.stdout).toContain(`capture ${capture.captureId.slice(0, 12)}`)
  })

  test('rejects path limiting and --staged outside working-tree captures', async () => {
    const repo = await committedFixtureRepo()

    for (const args of [
      ['inspect', 'HEAD', '--', 'committed.ts'],
      ['inspect', '--from', 'HEAD^1', '--to', 'HEAD', '--', 'committed.ts'],
      ['inspect', '--staged', 'HEAD'],
      ['inspect', '--staged', '--from', 'HEAD^1', '--to', 'HEAD'],
      ['inspect', 'HEAD', 'extra'],
    ]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  })
})

describe('changes', () => {
  test('prints a concise human summary', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['changes'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/changes across \d+ files · capture [0-9a-f]{12}/)
    expect(result.stdout).toContain('change-001')
    expect(result.stdout).toContain('greeting.ts')
    expect(result.stdout).toContain('old ')
  })

  test('--json returns structured data without full file contents', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['changes', '--json'], repo)

    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout) as {
      captureId: string
      changes: { id: string; path: string; oldStart: number; oldCount: number; newStart: number; newCount: number; before: string; after: string }[]
    }
    expect(data.captureId).toMatch(/^[0-9a-f]{64}$/)
    expect(data.changes.length).toBeGreaterThan(0)
    for (const change of data.changes) {
      expect(change.id).toMatch(/^change-\d{3}$/)
      expect(change.path).toMatch(/\.ts$/)
      expect(typeof change.oldStart).toBe('number')
      expect(typeof change.newStart).toBe('number')
      expect(change.before).toBeDefined()
      expect(change.after).toBeDefined()
    }
    expect(result.stdout).not.toContain('"oldContent"')
    expect(result.stdout).not.toContain('"newContent"')
    expect(result.stdout).not.toContain('"files"')
    expect(result.stdout).not.toContain('keep')

    const repeated = await runCli(['changes', '--json', '--json'], repo)
    expect(repeated.exitCode).toBe(0)
    expect(() => JSON.parse(repeated.stdout)).not.toThrow()
  })
})

describe('change', () => {
  test('reads one captured block with coordinates and contents', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    const change = capture.changes[0]!

    const result = await runCli(['change', change.id], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(change.id)
    expect(result.stdout).toContain(change.path)
    expect(result.stdout).toContain('before:')
    expect(result.stdout).toContain('after:')
    expect(result.stdout).toContain(change.before)
    expect(result.stdout).toContain(change.after)
  })

  test('rejects unknown IDs', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['change', 'change-999'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Unknown change ID: change-999')
  })
})

describe('file', () => {
  test('--before and --after read the exact captured sides', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    const file = capture.files.find((candidate) => candidate.path === 'greeting.ts')!

    const before = await runCli(['file', 'greeting.ts', '--before'], repo)
    expect(before.exitCode).toBe(0)
    expect(before.stdout).toBe(file.oldContent)

    const after = await runCli(['file', 'greeting.ts', '--after'], repo)
    expect(after.exitCode).toBe(0)
    expect(after.stdout).toBe(file.newContent)
  })

  test('rejects unknown paths and missing or double side selection', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const unknown = await runCli(['file', 'nope.ts', '--before'], repo)
    expect(unknown.exitCode).not.toBe(0)
    expect(unknown.stderr).toContain('Unknown file path: nope.ts')

    const missing = await runCli(['file', 'greeting.ts'], repo)
    expect(missing.exitCode).not.toBe(0)
    expect(missing.stderr).toContain('--before or --after')

    const double = await runCli(['file', 'greeting.ts', '--before', '--after'], repo)
    expect(double.exitCode).not.toBe(0)
    expect(double.stderr).toContain('--before or --after')

    const repeated = await runCli(
      ['file', 'greeting.ts', '--before', '--before', '--after'],
      repo,
    )
    expect(repeated.exitCode).not.toBe(0)
    expect(repeated.stderr).toContain('--before or --after')
  })
})

describe('check', () => {
  test('succeeds with useful counts after every change is assigned', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    await authorEveryChange(repo)

    const result = await runCli(['check'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(
      /OK: \d+ sections and \d+ steps cover \d+ of \d+ changes across \d+ files · capture /,
    )
    expect(result.stdout).toContain('Next:')
  })

  test('rejects a skeleton with unassigned changes', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Unassigned change IDs')
  })

  test('reports a stale captureId with a useful next step', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    await writeExplanations(
      repo,
      everyChangeYaml('f'.repeat(64), capture.changes),
    )

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('capture')
    expect(result.stderr).toContain('changed')
    expect(result.stderr).toContain('explanations.yaml')
  })

  test('rejects malformed YAML', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await writeExplanations(repo, 'captureId: [unclosed\n')

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Invalid explanations YAML')
  })

  test('schema violations name the field and the explanations file', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    await writeExplanations(
      repo,
      `captureId: ${capture.captureId}\ntitle: A change set\nsections:\n  - title: 42\n    steps:\n      - changes:\n          - change-001\n`,
    )

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('title: Invalid input: expected string')
    expect(result.stderr).toContain('.diffwalk/')
    expect(result.stderr).toContain('explanations.yaml')
  })

  test('a clean working tree reports a clear message instead of a cryptic schema error', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'diffwalk-cli-'))
    directories.push(repo)
    await initializeRepository(repo)
    await writeFile(join(repo, 'base.ts'), 'base\n')
    await git(['add', '.'], repo)
    await git(['commit', '-q', '-m', 'base'], repo)

    await runCli(['inspect'], repo)
    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('No captured changes or authored sections')
  })

  test('rejects an unknown change ID', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    await writeExplanations(
      repo,
      `captureId: ${capture.captureId}\ntitle: A change set\nsections:\n  - title: Nope\n    steps:\n      - changes:\n          - change-999\n`,
    )

    const unknown = await runCli(['check'], repo)
    expect(unknown.exitCode).not.toBe(0)
    expect(unknown.stderr).toContain('Unknown change ID: change-999')
  })

  // Showing a change twice is how an author builds an argument, so check reports it and
  // still succeeds. Only an unexplained change fails.
  test('reports a change shown more than once without failing', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    const first = capture.changes[0]!
    const rest = capture.changes.slice(1)
    await writeExplanations(
      repo,
      `captureId: ${capture.captureId}\n` +
        `title: A change set\n` +
        `sections:\n` +
        `  - title: For context\n    steps:\n      - text: A first look.\n        changes:\n          - ${first.id}\n` +
        `  - title: In detail\n    steps:\n      - text: The same hunk again.\n        changes:\n` +
        [first, ...rest].map((change) => `          - ${change.id}\n`).join(''),
    )

    const result = await runCli(['check'], repo)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`1 changes are shown more than once: ${first.id}`)
  })

  test('rejects a materialization mismatch', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const capturePath = join(await currentWalkDir(repo), 'capture.json')
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as { changes: { before: string }[] }
    capture.changes[0]!.before = 'tampered\n'
    await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`)

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('no longer matches captured file content')
  })
})

describe('view', () => {
  test('serves the rendered review through the built CLI until the process stops', async () => {
    if (process.platform === 'win32') return

    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const bin = join(repo, 'bin')
    const openedUrlPath = join(repo, 'opened-url')
    const launcher = process.platform === 'darwin' ? 'open' : 'xdg-open'
    await mkdir(bin)
    await writeFile(
      join(bin, launcher),
      '#!/bin/sh\nprintf "%s" "$1" > "$DIFFWALK_OPENED_URL"\n',
    )
    await chmod(join(bin, launcher), 0o755)

    const child = Bun.spawn(['node', cliPath, 'view'], {
      cwd: repo,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        DIFFWALK_OPENED_URL: openedUrlPath,
      },
    })
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()

    try {
      let previewUrl = ''
      for (let attempt = 0; attempt < 100 && previewUrl === ''; attempt++) {
        previewUrl = await readFile(openedUrlPath, 'utf8').catch(() => '')
        if (previewUrl === '') await Bun.sleep(20)
      }
      expect(previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      const response = await fetch(previewUrl)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const html = await response.text()
      expect(html).toContain('<title>A change set</title>')
      expect(html).toContain('data-copy-fragment="change-001"')
      expect((await fetch(`${previewUrl}/other`)).status).toBe(404)
      expect(await readdir(await currentWalkDir(repo))).not.toContain('diffwalk.html')

      child.kill('SIGTERM')
      await child.exited
      expect(await stdout).toContain(`Viewing 2 sections at ${previewUrl}`)
      expect(await stderr).toBe('')
      await expect(fetch(previewUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
    } finally {
      child.kill('SIGKILL')
      await child.exited
    }
  })
})

describe('HTML export', () => {
  test('writes a self-contained HTML report from capture plus explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const output = join(repo, 'out', 'report.html')

    const result = await runCli(['export', 'html', '--output', output], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Wrote a')
    expect(result.stdout).toContain(output)
    const html = await readFile(output, 'utf8')
    expect(html).toContain('<title>A change set</title>')
    expect(html).toContain('Section 1')
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  test('defaults to diffwalk.html in the current walk', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['export', 'html'], repo)

    expect(result.exitCode).toBe(0)
    const files = await readdir(await currentWalkDir(repo))
    expect(files).toContain('diffwalk.html')
  })
})

describe('JSON export', () => {
  test('writes a version 1 ExplainDocument from capture plus explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const output = join(repo, 'out', 'document.json')

    const result = await runCli(['export', 'json', '--output', output], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Wrote')
    const document = JSON.parse(await readFile(output, 'utf8')) as {
      formatVersion: number
      title: string
      summary: string
      source: { kind: string }
      sections: { title: string; steps: { text: string; diff?: string; changes?: string[] }[] }[]
    }
    expect(document.formatVersion).toBe(1)
    expect(document.title).toBe('A change set')
    expect(document.source.kind).toBe('working-tree')
    expect(document.sections.length).toBeGreaterThan(0)
    for (const section of document.sections) {
      expect(section.title).toMatch(/^Section \d+$/)
      expect(section.steps[0]!.diff).toContain('diff --git')
      expect(section.steps[0]!.changes).toEqual([expect.stringMatching(/^change-\d+$/)])
    }
  })

  test('defaults to diffwalk.json in the current walk', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['export', 'json'], repo)

    expect(result.exitCode).toBe(0)
    const files = await readdir(await currentWalkDir(repo))
    expect(files).toContain('diffwalk.json')
  })
})

interface FakeService {
  origin: string
  published: unknown[]
  updated: { id: string; token: string; body: unknown }[]
  revoked: { id: string; token: string }[]
  stop: () => void
}

const reportId = 'Zm9vYmFyYmF6cXV4MTIz'
const revocationToken = 'end-to-end-revocation-token'

function startFakeService(): FakeService {
  const published: unknown[] = []
  const updated: { id: string; token: string; body: unknown }[] = []
  const revoked: { id: string; token: string }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const credential = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')

      if (request.method === 'POST' && url.pathname === '/api/reports') {
        published.push(await request.json())
        return Response.json({ id: reportId, revocationToken }, { status: 201 })
      }

      const report = /^\/api\/reports\/(.+)$/.exec(url.pathname)
      if (request.method === 'PUT' && report) {
        if (credential !== revocationToken) {
          return Response.json(
            { error: 'That credential does not update this report' },
            { status: 403 },
          )
        }
        updated.push({ id: report[1]!, token: credential, body: await request.json() })
        return Response.json({ id: report[1]! }, { status: 200 })
      }

      if (request.method === 'DELETE' && report) {
        if (credential !== revocationToken) {
          return Response.json(
            { error: 'That credential does not revoke this report' },
            { status: 403 },
          )
        }
        revoked.push({ id: report[1]!, token: credential })
        return new Response(null, { status: 204 })
      }

      return Response.json({ error: 'No such endpoint' }, { status: 404 })
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    published,
    updated,
    revoked,
    stop: () => server.stop(true),
  }
}

describe('publish', () => {
  test('uploads the materialized document and prints the link and its revocation token', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const service = startFakeService()

    try {
      const result = await runCli(['publish', '--service', service.origin], repo)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`${service.origin}/r/${reportId}`)
      expect(result.stdout).toContain(revocationToken)
      expect(result.stdout).toContain(`diffwalk unpublish ${reportId} --token ${revocationToken}`)

      expect(service.published).toHaveLength(1)
      const uploaded = service.published[0] as Record<string, unknown>
      expect(uploaded['formatVersion']).toBe(1)
      expect(Array.isArray(uploaded['sections'])).toBe(true)
      expect(uploaded['captureId']).toBeUndefined()
      expect(uploaded['files']).toBeUndefined()
      expect(JSON.stringify(uploaded)).not.toContain('<!doctype html>')
    } finally {
      service.stop()
    }
  })

  test('publishing without authored explanations fails before contacting the service', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const service = startFakeService()

    try {
      const result = await runCli(['publish', '--service', service.origin], repo)

      expect(result.exitCode).not.toBe(0)
      expect(service.published).toHaveLength(0)
    } finally {
      service.stop()
    }
  })

  test('a plaintext service is refused before anything is uploaded', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['publish', '--service', 'http://reports.example.test'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('over HTTPS')
  })

  test('publish --update replaces the retained link content and keeps its ID', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const service = startFakeService()

    try {
      const first = await runCli(['publish', '--service', service.origin], repo)
      expect(first.exitCode).toBe(0)
      expect(first.stdout).toContain(`${service.origin}/r/${reportId}`)

      await writeExplanations(
        repo,
        (await readExplanationsYaml(repo)).replace('title: A change set', 'title: Updated change'),
      )

      const update = await runCli(['publish', '--update'], repo)

      expect(update.exitCode).toBe(0)
      expect(update.stdout).toContain(`${service.origin}/r/${reportId}`)
      expect(update.stdout).toContain(reportId)
      expect(service.published).toHaveLength(1)
      expect(service.updated).toHaveLength(1)
      expect(service.updated[0]!.id).toBe(reportId)
      expect(service.updated[0]!.token).toBe(revocationToken)
      expect((service.updated[0]!.body as { title: string }).title).toBe('Updated change')

      const retainedPath = join(await currentWalkDir(repo), 'published.json')
      const retainedBefore = await readFile(retainedPath, 'utf8')
      const again = await runCli(['publish', '--update'], repo)
      expect(again.exitCode).toBe(0)
      expect(service.updated).toHaveLength(2)
      expect(await readFile(retainedPath, 'utf8')).toBe(retainedBefore)
    } finally {
      service.stop()
    }
  })

  test('publish --update without a retained review asks for a first publish', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['publish', '--update'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('diffwalk publish')
  })

  test('publish --update refuses a service other than the retained host', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const service = startFakeService()

    try {
      await runCli(['publish', '--service', service.origin], repo)

      const result = await runCli(
        ['publish', '--update', '--service', 'https://other.example.test'],
        repo,
      )

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain(service.origin)
      expect(service.updated).toHaveLength(0)
    } finally {
      service.stop()
    }
  })

  test('publish --update surfaces a rejected credential', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const service = startFakeService()

    try {
      await runCli(['publish', '--service', service.origin], repo)
      const retainedPath = join(await currentWalkDir(repo), 'published.json')
      const retained = JSON.parse(await readFile(retainedPath, 'utf8')) as {
        revocationToken: string
      }
      retained.revocationToken = 'stale-token'
      await writeFile(retainedPath, `${JSON.stringify(retained, null, 2)}\n`)

      const result = await runCli(['publish', '--update'], repo)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Could not update the review')
      expect(result.stderr).toContain('403')
      expect(service.updated).toHaveLength(0)
    } finally {
      service.stop()
    }
  })
})

describe('unpublish', () => {
  test('removes a report with its revocation token', async () => {
    const repo = await fixtureRepo()
    const service = startFakeService()

    try {
      const result = await runCli(
        ['unpublish', reportId, '--token', revocationToken, '--service', service.origin],
        repo,
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Removed review ${reportId}`)
      expect(service.revoked).toEqual([{ id: reportId, token: revocationToken }])
    } finally {
      service.stop()
    }
  })

  test('a wrong token leaves the report in place and explains why', async () => {
    const repo = await fixtureRepo()
    const service = startFakeService()

    try {
      const result = await runCli(
        ['unpublish', reportId, '--token', 'wrong-token', '--service', service.origin],
        repo,
      )

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Could not remove the review')
      expect(result.stderr).toContain('403')
      expect(service.revoked).toHaveLength(0)
    } finally {
      service.stop()
    }
  })

  test('a missing token or report ID is a usage error with help', async () => {
    const repo = await fixtureRepo()

    const noToken = await runCli(['unpublish', reportId], repo)
    expect(noToken.exitCode).not.toBe(0)
    expect(noToken.stderr).toContain('--token')

    const noId = await runCli(['unpublish', '--token', revocationToken], repo)
    expect(noId.exitCode).not.toBe(0)
    expect(noId.stderr).toContain("missing required argument 'id'")
  })
})

describe('removed workflow', () => {
  test('the build command is rejected as unknown', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['build'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('too many arguments')
  })

  test('the report command is replaced by export html', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['report'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('too many arguments')
  })

  test('the old combined draft is not accepted as input', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const walkDirectory = await currentWalkDir(repo)
    const capturePath = join(walkDirectory, 'capture.json')
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Record<string, unknown>
    await writeFile(
      join(walkDirectory, 'draft.json'),
      `${JSON.stringify({ draftVersion: 1, ...capture, sections: [] }, null, 2)}\n`,
    )

    const result = await runCli(['changes', '--input', join(walkDirectory, 'draft.json')], repo)

    expect(result.exitCode).not.toBe(0)
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
