import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureSchema } from '../src/format'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const cliPath = join(import.meta.dir, '..', 'src', 'cli.ts')

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
  const child = Bun.spawn(['bun', cliPath, ...args], {
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

function explainDir(repo: string) {
  return join(repo, '.explain')
}

async function readCapture(repo: string) {
  return captureSchema.parse(
    JSON.parse(await readFile(join(explainDir(repo), 'capture.json'), 'utf8')),
  )
}

async function readExplanationsYaml(repo: string) {
  return readFile(join(explainDir(repo), 'explanations.yaml'), 'utf8')
}

async function writeExplanations(repo: string, yaml: string) {
  await writeFile(join(explainDir(repo), 'explanations.yaml'), yaml)
}

async function authorEveryChange(repo: string) {
  const capture = await readCapture(repo)
  const yaml =
    `captureId: ${capture.captureId}\n` +
    `sections:\n` +
    capture.changes
      .map(
        (change, index) =>
          `  - title: Section ${index + 1}\n    body: Body\n    changes:\n      - ${change.id}\n`,
      )
      .join('')
  await writeExplanations(repo, yaml)
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

describe('help', () => {
  test('bare diffwalk, --help, and -h exit 0 and describe the workflow', async () => {
    const repo = await fixtureRepo()
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Quick start')
      expect(result.stdout).toContain('inspect')
      expect(result.stdout).toContain('explanations.yaml')
      expect(result.stdout).toContain('check')
      expect(result.stdout).toContain('File ownership')
    }
  })

  test('help <command> describes options, defaults, and next steps', async () => {
    const repo = await fixtureRepo()
    for (const command of ['inspect', 'changes', 'change', 'file', 'check', 'view', 'report', 'export', 'publish']) {
      const result = await runCli(['help', command], repo)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`diffwalk ${command} —`)
      expect(result.stdout).toContain('Options:')
      expect(result.stdout).toContain('Next steps:')
      expect(result.stdout).toContain('.explain/capture.json')
    }
  })

  test('help unpublish describes the revocation token it requires', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['help', 'unpublish'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('diffwalk unpublish —')
    expect(result.stdout).toContain('--token')
    expect(result.stdout).toContain('Next steps:')
  })

  test('help for an unknown command exits nonzero', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['help', 'bogus'], repo)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Unknown command: bogus')
  })

  test('help rejects extra topics and unknown options with usage guidance', async () => {
    const repo = await fixtureRepo()
    const cases: string[][] = [
      ['help', 'inspect', 'extra'],
      ['help', 'inspect', 'extra', 'more'],
      ['help', '--bogus'],
      ['help', 'inspect', '--bogus'],
    ]
    for (const args of cases) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('diffwalk help')
    }
  })

  test('help still succeeds with --help, -h, or a topic plus --help', async () => {
    const repo = await fixtureRepo()
    for (const args of [
      ['help', '--help'],
      ['help', '-h'],
      ['help', 'inspect', '--help'],
      ['help', 'inspect'],
    ]) {
      const result = await runCli(args, repo)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('diffwalk')
    }
  })

  test('an unknown top-level command exits nonzero', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['bogus'], repo)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Unknown command: bogus')
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
      ['report', 'document.json'],
      ['changes', 'stray-positional'],
    ]
    for (const args of cases) {
      const result = await runCli(args, repo)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('diffwalk')
    }
  })

  test('command --help exits 0 and does not run the command', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['inspect', '--help'], repo)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('diffwalk inspect —')
  })
})

describe('inspect', () => {
  test('writes capture.json and an explanations.yaml skeleton, then tells the next steps', async () => {
    const repo = await fixtureRepo()
    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Captured')
    expect(result.stdout).toContain('change blocks across')
    expect(result.stdout).toContain('.explain/capture.json')
    expect(result.stdout).toContain('Wrote a .explain/explanations.yaml skeleton')
    expect(result.stdout).toContain('Next: edit .explain/explanations.yaml')

    const capture = await readCapture(repo)
    expect(capture.captureId).toMatch(/^[0-9a-f]{64}$/)
    expect(capture.files.map((file) => file.path)).toEqual(['greeting.ts', 'untracked.ts'])
    expect(capture.changes.length).toBeGreaterThan(0)
    expect(capture).not.toHaveProperty('sections')

    const yaml = await readExplanationsYaml(repo)
    expect(yaml).toContain(`captureId: ${capture.captureId}`)
    expect(yaml).toContain('sections: []')
  })

  test('never overwrites an authored explanations.yaml', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await writeExplanations(repo, '# my authored file\ncaptureId: stale\nsections: []\n')

    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Kept existing .explain/explanations.yaml')
    expect(await readExplanationsYaml(repo)).toBe(
      '# my authored file\ncaptureId: stale\nsections: []\n',
    )
  })

  test('refreshes capture.json on content change while preserving explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const first = await readCapture(repo)
    await authorEveryChange(repo)

    await writeFile(join(repo, 'greeting.ts'), 'Hello\nGalaxy\n')
    const result = await runCli(['inspect'], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Kept existing .explain/explanations.yaml')
    const second = await readCapture(repo)
    expect(second.captureId).not.toBe(first.captureId)
    expect(await readExplanationsYaml(repo)).toContain(`captureId: ${first.captureId}`)
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
    expect(inspect.stdout).not.toContain('.explain/capture.json')

    const bare = await runCli(['check'], repo)
    expect(bare.exitCode).not.toBe(0)
    expect(bare.stderr).toContain('No capture at .explain/capture.json')

    const capture = JSON.parse(await readFile(join(repo, capturePath), 'utf8')) as {
      captureId: string
      changes: { id: string }[]
    }
    await writeFile(
      join(repo, explanationsPath),
      `captureId: ${capture.captureId}\n` +
        `sections:\n` +
        capture.changes
          .map(
            (change, index) =>
              `  - title: Section ${index + 1}\n    body: Body\n    changes:\n      - ${change.id}\n`,
          )
          .join(''),
    )

    const check = await runCli(
      ['check', '--input', capturePath, '--explanations', explanationsPath],
      repo,
    )
    expect(check.exitCode).toBe(0)
    expect(check.stdout).toContain('OK:')
  })

  test('prints only the flags that differ from defaults in the check next step', async () => {
    const repo = await fixtureRepo()

    const inspect = await runCli(['inspect', '--output', 'out/capture.json'], repo)

    expect(inspect.exitCode).toBe(0)
    expect(inspect.stdout).toContain(
      'Next: edit .explain/explanations.yaml, then run `diffwalk check --input out/capture.json`.',
    )
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
      /OK: \d+ sections cover \d+ of \d+ changes across \d+ files · capture /,
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
    await authorEveryChange(repo)
    await writeFile(join(repo, 'greeting.ts'), 'Hello\nGalaxy\n')
    await runCli(['inspect'], repo)

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
      `captureId: ${capture.captureId}\nsections:\n  - title: 42\n    changes:\n      - change-001\n`,
    )

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('title: Invalid input: expected string')
    expect(result.stderr).toContain('.explain/explanations.yaml')
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

  test('rejects unknown and duplicate assignments', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capture = await readCapture(repo)
    await writeExplanations(
      repo,
      `captureId: ${capture.captureId}\nsections:\n  - title: Nope\n    changes:\n      - change-999\n`,
    )

    const unknown = await runCli(['check'], repo)
    expect(unknown.exitCode).not.toBe(0)
    expect(unknown.stderr).toContain('Unknown change ID: change-999')

    const first = capture.changes[0]!
    await writeExplanations(
      repo,
      `captureId: ${capture.captureId}\nsections:\n  - title: One\n    changes:\n      - ${first.id}\n  - title: Two\n    changes:\n      - ${first.id}\n`,
    )
    const duplicate = await runCli(['check'], repo)
    expect(duplicate.exitCode).not.toBe(0)
    expect(duplicate.stderr).toContain('assigned more than once')
  })

  test('rejects a materialization mismatch', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const capturePath = join(explainDir(repo), 'capture.json')
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as { changes: { before: string }[] }
    capture.changes[0]!.before = 'tampered\n'
    await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`)

    const result = await runCli(['check'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('no longer matches captured file content')
  })
})

describe('report', () => {
  test('writes a self-contained HTML report from capture plus explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const output = join(repo, 'out', 'report.html')

    const result = await runCli(['report', '--output', output], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Wrote a')
    expect(result.stdout).toContain(output)
    const html = await readFile(output, 'utf8')
    expect(html).toContain('Diffwalk change report')
    expect(html).toContain('Section 1')
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  test('defaults to .explain/report.html', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['report'], repo)

    expect(result.exitCode).toBe(0)
    const files = await readdir(explainDir(repo))
    expect(files).toContain('report.html')
  })
})

describe('export', () => {
  test('writes a version 1 ExplainDocument from capture plus explanations', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)
    const output = join(repo, 'out', 'document.json')

    const result = await runCli(['export', '--output', output], repo)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Wrote')
    const document = JSON.parse(await readFile(output, 'utf8')) as {
      formatVersion: number
      source: { kind: string }
      sections: { explain: { title: string }; diff: string }[]
    }
    expect(document.formatVersion).toBe(1)
    expect(document.source.kind).toBe('working-tree')
    expect(document.sections.length).toBeGreaterThan(0)
    for (const section of document.sections) {
      expect(section.explain.title).toMatch(/^Section \d+$/)
      expect(section.diff).toContain('diff --git')
    }
  })

  test('defaults to .explain/document.json', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    await authorEveryChange(repo)

    const result = await runCli(['export'], repo)

    expect(result.exitCode).toBe(0)
    const files = await readdir(explainDir(repo))
    expect(files).toContain('document.json')
  })
})

interface FakeService {
  origin: string
  published: unknown[]
  revoked: { id: string; token: string }[]
  stop: () => void
}

const reportId = 'Zm9vYmFyYmF6cXV4MTIz'
const revocationToken = 'end-to-end-revocation-token'

function startFakeService(): FakeService {
  const published: unknown[] = []
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

      const revoke = /^\/api\/reports\/(.+)$/.exec(url.pathname)
      if (request.method === 'DELETE' && revoke) {
        if (credential !== revocationToken) {
          return Response.json(
            { error: 'That credential does not revoke this report' },
            { status: 403 },
          )
        }
        revoked.push({ id: revoke[1]!, token: credential })
        return new Response(null, { status: 204 })
      }

      return Response.json({ error: 'No such endpoint' }, { status: 404 })
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    published,
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
      expect(result.stdout).toContain(`Removed report ${reportId}`)
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
      expect(result.stderr).toContain('Could not remove the report')
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
    expect(noToken.stderr).toContain('diffwalk unpublish')

    const noId = await runCli(['unpublish', '--token', revocationToken], repo)
    expect(noId.exitCode).not.toBe(0)
    expect(noId.stderr).toContain('exactly 1 argument')
  })
})

describe('removed workflow', () => {
  test('the build command is rejected as unknown', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)

    const result = await runCli(['build'], repo)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Unknown command: build')
  })

  test('the old combined draft is not accepted as input', async () => {
    const repo = await fixtureRepo()
    await runCli(['inspect'], repo)
    const capturePath = join(explainDir(repo), 'capture.json')
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as Record<string, unknown>
    await writeFile(
      join(explainDir(repo), 'draft.json'),
      `${JSON.stringify({ draftVersion: 1, ...capture, sections: [] }, null, 2)}\n`,
    )

    const result = await runCli(['changes', '--input', join(explainDir(repo), 'draft.json')], repo)

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
