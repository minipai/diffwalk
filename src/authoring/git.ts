import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DraftFile } from '../format'

export interface GitCapture {
  root: string
  baseCommit: string
  files: DraftFile[]
}

export interface CaptureGitChangesOptions {
  staged?: boolean
  paths?: string[]
}

export interface GitRevisionCapture extends GitCapture {
  fromRevision: string
  toRevision: string
  fromCommit: string
  toCommit: string
}

interface GitChange {
  kind: string
  path: string
  oldPath?: string
  oldMode: DraftFile['oldMode']
  newMode: DraftFile['newMode']
}

const supportedGitModes = new Set(['000000', '100644', '100755'])

export async function captureGitChanges(
  base = 'HEAD',
  cwd = process.cwd(),
  options: CaptureGitChangesOptions = {},
): Promise<GitCapture> {
  const { staged = false, paths = [] } = options
  const root = (await gitText(['rev-parse', '--show-toplevel'], cwd)).trim()
  const baseCommit = (
    await gitText(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], root)
  ).trim()
  const pathEnvironment = paths.length > 0 ? { GIT_LITERAL_PATHSPECS: '1' } : {}
  const changes = parseGitChanges(
    await gitBytes(
      ['diff', '--raw', '-z', '--find-renames', ...(staged ? ['--cached'] : []), baseCommit, '--', ...paths],
      root,
      pathEnvironment,
    ),
  )
  const newContentFor = staged
    ? (path: string) => indexFile(path, root)
    : (path: string) => workingTreeFile(path, root)
  const files: DraftFile[] = []

  for (const change of changes) {
    if (change.kind === 'R') {
      files.push({
        path: change.path,
        oldPath: change.oldPath,
        status: 'renamed',
        oldMode: change.oldMode,
        newMode: change.newMode,
        oldContent: await gitFile(baseCommit, change.oldPath!, root),
        newContent: await newContentFor(change.path),
      })
      continue
    }

    if (change.kind === 'M') {
      const oldContent = await gitFile(baseCommit, change.path, root)
      const newContent = await newContentFor(change.path)
      if (change.oldMode !== change.newMode && oldContent === newContent) {
        throw new Error(`File mode changes are not supported: ${change.path}`)
      }
      files.push({
        path: change.path,
        status: 'modified',
        oldMode: change.oldMode,
        newMode: change.newMode,
        oldContent,
        newContent,
      })
    } else if (change.kind === 'A') {
      files.push({
        path: change.path,
        status: 'added',
        oldMode: change.oldMode,
        newMode: change.newMode,
        oldContent: '',
        newContent: await newContentFor(change.path),
      })
    } else if (change.kind === 'D') {
      files.push({
        path: change.path,
        status: 'deleted',
        oldMode: change.oldMode,
        newMode: change.newMode,
        oldContent: await gitFile(baseCommit, change.path, root),
        newContent: '',
      })
    } else {
      throw new Error(`Unsupported Git change status: ${change.kind}`)
    }
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]))
  if (!staged) {
    const untracked = splitNulls(
      await gitBytes(
        ['ls-files', '--others', '--exclude-standard', '--exclude=.diffwalk/', '-z', '--', ...paths],
        root,
        pathEnvironment,
      ),
    )
    for (const path of untracked) {
      const existing = filesByPath.get(path)
      if (existing !== undefined) {
        if (existing.status !== 'deleted') continue
        const newContent = await workingTreeFile(path, root)
        const newMode = await workingTreeMode(path, root)
        if (existing.oldMode !== newMode && existing.oldContent === newContent) {
          throw new Error(`File mode changes are not supported: ${path}`)
        }
        if (existing.oldContent === newContent) {
          filesByPath.delete(path)
        } else {
          filesByPath.set(path, {
            path,
            status: 'modified',
            oldMode: existing.oldMode,
            newMode,
            oldContent: existing.oldContent,
            newContent,
          })
        }
        continue
      }

      filesByPath.set(path, {
        path,
        status: 'added',
        oldMode: '000000',
        newMode: await workingTreeMode(path, root),
        oldContent: '',
        newContent: await workingTreeFile(path, root),
      })
    }
  }

  return {
    root,
    baseCommit,
    files: [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export async function captureGitRevisionChanges(
  from: string,
  to: string,
  cwd = process.cwd(),
): Promise<GitRevisionCapture> {
  const root = (await gitText(['rev-parse', '--show-toplevel'], cwd)).trim()
  const fromCommit = await commitForRevision(from, root)
  const toCommit = await commitForRevision(to, root)
  const changes = parseGitChanges(
    await gitBytes(['diff', '--no-ext-diff', '--raw', '-z', '--find-renames', fromCommit, toCommit, '--'], root),
  )
  const files: DraftFile[] = []

  for (const change of changes) {
    const oldContent = change.kind === 'A' ? '' : await gitFile(fromCommit, change.oldPath ?? change.path, root)
    const newContent = change.kind === 'D' ? '' : await gitFile(toCommit, change.path, root)
    if (change.kind === 'M' && change.oldMode !== change.newMode && oldContent === newContent) {
      throw new Error(`File mode changes are not supported: ${change.path}`)
    }
    files.push({
      path: change.path,
      ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
      status: change.kind === 'R' ? 'renamed' : change.kind === 'M' ? 'modified' : change.kind === 'A' ? 'added' : 'deleted',
      oldMode: change.oldMode,
      newMode: change.newMode,
      oldContent,
      newContent,
    })
  }

  return {
    root,
    baseCommit: fromCommit,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    fromRevision: from,
    toRevision: to,
    fromCommit,
    toCommit,
  }
}

export async function commitForRevision(revision: string, root = process.cwd()): Promise<string> {
  return (await gitText(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], root)).trim()
}

// Reflects whatever Git would stamp on the next commit. A missing or empty name is the
// only reason to omit it, so every other failure also means "unavailable".
export async function gitUserName(root = process.cwd()): Promise<string | undefined> {
  try {
    const name = (await gitText(['config', 'user.name'], root)).trim()
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}

async function workingTreeFile(path: string, root: string): Promise<string> {
  const absolutePath = resolve(root, path)
  const pathWithinRoot = relative(root, absolutePath)
  if (isAbsolute(pathWithinRoot) || pathWithinRoot.startsWith('..')) {
    throw new Error(`Git path escapes the repository: ${path}`)
  }

  const file = await lstat(absolutePath)
  if (file.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`)
  if (!file.isFile()) throw new Error(`Non-file Git paths are not supported: ${path}`)

  const scratch = await mkdtemp(join(tmpdir(), 'diffwalk-working-tree-'))
  try {
    const objectDirectory = join(scratch, 'objects')
    await mkdir(objectDirectory)
    const environment = { GIT_OBJECT_DIRECTORY: objectDirectory }
    const object = (
      await gitText(['hash-object', '-w', `--path=${path}`, '--', absolutePath], root, environment)
    ).trim()
    return decodeText(await gitBytes(['cat-file', 'blob', object], root, environment), path)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function workingTreeMode(path: string, root: string): Promise<DraftFile['newMode']> {
  const file = await lstat(resolve(root, path))
  return (file.mode & 0o100) === 0 ? '100644' : '100755'
}

async function gitFile(commit: string, path: string, root: string): Promise<string> {
  return decodeText(await gitBytes(['show', `${commit}:${path}`], root), path)
}

async function indexFile(path: string, root: string): Promise<string> {
  return decodeText(await gitBytes(['show', `:${path}`], root), path)
}

async function gitText(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<string> {
  return decodeText(await gitBytes(args, cwd, environment), `git ${args[0]}`)
}

async function gitBytes(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<Uint8Array> {
  const child = spawn('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...environment },
  })
  const stdout: Uint8Array[] = []
  let stderr = ''
  child.stdout.on('data', (chunk: Uint8Array) => stdout.push(chunk))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const exitCode = await new Promise<number>((accept, reject) => {
    child.once('error', reject)
    child.once('close', (code) => accept(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args[0]} exited with ${exitCode}`)
  }
  const length = stdout.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of stdout) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decodeText(bytes: Uint8Array, label: string): string {
  if (bytes.includes(0)) throw new Error(`Binary files are not supported: ${label}`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`File is not valid UTF-8: ${label}`)
  }
}

function splitNulls(bytes: Uint8Array): string[] {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return value === '' ? [] : value.slice(0, value.endsWith('\0') ? -1 : undefined).split('\0')
}

function parseGitChanges(bytes: Uint8Array): GitChange[] {
  const fields = splitNulls(bytes)
  const changes: GitChange[] = []

  for (let index = 0; index < fields.length; ) {
    const header = requireField(fields[index++], 'raw diff header')
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(header)
    if (!match) throw new Error(`Malformed git raw diff header: ${header}`)

    const [, oldMode, newMode, kind] = match
    const firstPath = requireField(fields[index++], header)
    const oldPath = kind === 'R' ? firstPath : undefined
    const path = kind === 'R' ? requireField(fields[index++], header) : firstPath
    if (!supportedGitModes.has(oldMode!) || !supportedGitModes.has(newMode!)) {
      throw new Error(`Unsupported Git file type: ${path}`)
    }
    changes.push({
      kind: kind!,
      path,
      oldPath,
      oldMode: oldMode as DraftFile['oldMode'],
      newMode: newMode as DraftFile['newMode'],
    })
  }

  return changes
}

function requireField(value: string | undefined, context: string): string {
  if (value === undefined) throw new Error(`Malformed git output after ${context}`)
  return value
}
