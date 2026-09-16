import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { BinarySide, DraftFile } from '../format/types'

// A captured file side is text when its bytes decode as UTF-8, and binary otherwise.
// Binary sides keep only an identity: byte size and a content hash, never the bytes.
interface CapturedSide {
  content: string
  binary?: BinarySide
}

export interface GitCapture {
  root: string
  baseCommit: string
  files: DraftFile[]
}

export interface CaptureGitChangesOptions {
  staged?: boolean
  paths?: string[]
  exclude?: string[]
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
  oldMode: string
  newMode: string
}

const supportedGitModes = new Set(['000000', '100644', '100755'])

export async function captureGitChanges(
  base = 'HEAD',
  cwd = process.cwd(),
  options: CaptureGitChangesOptions = {},
): Promise<GitCapture> {
  const { staged = false, paths = [], exclude = [] } = options
  const root = (await gitText(['rev-parse', '--show-toplevel'], cwd)).trim()
  const baseCommit = (
    await gitText(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], root)
  ).trim()
  // Positive paths narrow the diff before Git pairs renames. Exclusions stay out of the
  // pathspec: Git must still see both sides of a rename so the move can be preserved, and
  // the excluded side is dropped after detection, before Diffwalk reads any content.
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
    const file = await draftChange(change, { baseCommit, root, newContentFor, exclude })
    if (file !== undefined) files.push(file)
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
      if (isExcluded(path, exclude)) continue
      const existing = filesByPath.get(path)
      if (existing !== undefined) {
        if (existing.status !== 'deleted') continue
        const oldSide = storedSide(existing, 'old')
        const newSide = await workingTreeFile(path, root)
        const newMode = await workingTreeMode(path, root)
        validateFileModeChange(path, existing.oldMode, newMode, oldSide, newSide)
        if (sidesMatch(oldSide, newSide)) {
          filesByPath.delete(path)
        } else {
          filesByPath.set(
            path,
            draftFile({
              path,
              status: 'modified',
              oldMode: existing.oldMode,
              newMode,
              oldSide,
              newSide,
            }),
          )
        }
        continue
      }

      filesByPath.set(
        path,
        draftFile({
          path,
          status: 'added',
          oldMode: '000000',
          newMode: await workingTreeMode(path, root),
          newSide: await workingTreeFile(path, root),
        }),
      )
    }
  }

  return {
    root,
    baseCommit,
    files: [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

async function draftChange(
  change: GitChange,
  context: {
    baseCommit: string
    root: string
    newContentFor: (path: string) => Promise<CapturedSide>
    exclude: string[]
  },
): Promise<DraftFile | undefined> {
  const { baseCommit, root, newContentFor, exclude } = context
  if (change.kind === 'R') {
    const oldExcluded = isExcluded(change.oldPath!, exclude)
    const newExcluded = isExcluded(change.path, exclude)
    if (oldExcluded && newExcluded) return undefined
    const { oldMode, newMode } = supportedModes(change)
    if (newExcluded) {
      return draftFile({
        path: change.oldPath!,
        excludedPath: change.path,
        status: 'moved-to-excluded',
        oldMode,
        newMode,
        oldSide: await gitFile(baseCommit, change.oldPath!, root),
      })
    }
    if (oldExcluded) {
      return draftFile({
        path: change.path,
        excludedPath: change.oldPath!,
        status: 'moved-from-excluded',
        oldMode,
        newMode,
        newSide: await newContentFor(change.path),
      })
    }
    return draftFile({
      path: change.path,
      oldPath: change.oldPath,
      status: 'renamed',
      oldMode,
      newMode,
      oldSide: await gitFile(baseCommit, change.oldPath!, root),
      newSide: await newContentFor(change.path),
    })
  }

  // Excluded paths are dropped before any type check or read, so an unsupported file that
  // the selection omits never blocks the capture.
  if (isExcluded(change.path, exclude)) return undefined
  const { oldMode, newMode } = supportedModes(change)
  if (change.kind === 'M') {
    const oldSide = await gitFile(baseCommit, change.path, root)
    const newSide = await newContentFor(change.path)
    validateFileModeChange(change.path, oldMode, newMode, oldSide, newSide)
    return draftFile({
      path: change.path,
      status: 'modified',
      oldMode,
      newMode,
      oldSide,
      newSide,
    })
  }
  if (change.kind === 'A') {
    return draftFile({
      path: change.path,
      status: 'added',
      oldMode,
      newMode,
      newSide: await newContentFor(change.path),
    })
  }
  if (change.kind === 'D') {
    return draftFile({
      path: change.path,
      status: 'deleted',
      oldMode,
      newMode,
      oldSide: await gitFile(baseCommit, change.path, root),
    })
  }
  throw new Error(`Unsupported Git change status: ${change.kind}`)
}

// Git describes the file type in the mode field. Only regular files are supported; symbolic
// links and submodules are rejected here, after exclusions have had their say.
function supportedModes(change: GitChange): { oldMode: DraftFile['oldMode']; newMode: DraftFile['newMode'] } {
  if (!supportedGitModes.has(change.oldMode) || !supportedGitModes.has(change.newMode)) {
    throw new Error(`Unsupported Git file type: ${change.path}`)
  }
  return {
    oldMode: change.oldMode as DraftFile['oldMode'],
    newMode: change.newMode as DraftFile['newMode'],
  }
}

// Exclusions name literal files or directories relative to the repository root. A directory
// covers everything under it on path boundaries, and "." is the whole repository. Comparing
// strings directly keeps names with glob characters literal.
function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((candidate) => {
    const name = candidate.startsWith('./') ? candidate.slice(2) : candidate
    if (name === '' || name === '.') return true
    return path === name || path.startsWith(name.endsWith('/') ? name : `${name}/`)
  })
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
    const { oldMode, newMode } = supportedModes(change)
    const oldSide = change.kind === 'A' ? undefined : await gitFile(fromCommit, change.oldPath ?? change.path, root)
    const newSide = change.kind === 'D' ? undefined : await gitFile(toCommit, change.path, root)
    if (change.kind === 'M') {
      validateFileModeChange(change.path, oldMode, newMode, oldSide!, newSide!)
    }
    files.push(
      draftFile({
        path: change.path,
        oldPath: change.oldPath,
        status:
          change.kind === 'R'
            ? 'renamed'
            : change.kind === 'M'
              ? 'modified'
              : change.kind === 'A'
                ? 'added'
                : 'deleted',
        oldMode,
        newMode,
        oldSide,
        newSide,
      }),
    )
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

async function workingTreeFile(path: string, root: string): Promise<CapturedSide> {
  const absolutePath = await validateWorkingTreeFile(path, root)
  const scratch = await mkdtemp(join(tmpdir(), 'diffwalk-working-tree-'))
  try {
    const objectDirectory = join(scratch, 'objects')
    await mkdir(objectDirectory)
    const environment = { GIT_OBJECT_DIRECTORY: objectDirectory }
    const object = (
      await gitText(['hash-object', '-w', `--path=${path}`, '--', absolutePath], root, environment)
    ).trim()
    return decodeFile(await gitBytes(['cat-file', 'blob', object], root, environment))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function validateFileModeChange(
  filePath: string,
  oldMode: DraftFile['oldMode'],
  newMode: DraftFile['newMode'],
  oldSide: CapturedSide,
  newSide: CapturedSide,
): void {
  if (oldMode !== newMode && sidesMatch(oldSide, newSide)) {
    throw new Error(`File mode changes are not supported: ${filePath}`)
  }
}

function draftFile(input: {
  path: string
  oldPath?: string
  excludedPath?: string
  status: DraftFile['status']
  oldMode: DraftFile['oldMode']
  newMode: DraftFile['newMode']
  oldSide?: CapturedSide
  newSide?: CapturedSide
}): DraftFile {
  return {
    path: input.path,
    ...(input.oldPath === undefined ? {} : { oldPath: input.oldPath }),
    ...(input.excludedPath === undefined ? {} : { excludedPath: input.excludedPath }),
    status: input.status,
    oldMode: input.oldMode,
    newMode: input.newMode,
    oldContent: input.oldSide?.content ?? '',
    newContent: input.newSide?.content ?? '',
    ...(input.oldSide?.binary === undefined ? {} : { oldBinary: input.oldSide.binary }),
    ...(input.newSide?.binary === undefined ? {} : { newBinary: input.newSide.binary }),
  }
}

function storedSide(file: DraftFile, side: 'old' | 'new'): CapturedSide {
  const binary = side === 'old' ? file.oldBinary : file.newBinary
  const content = side === 'old' ? file.oldContent : file.newContent
  return binary === undefined ? { content } : { content: '', binary }
}

function sidesMatch(left: CapturedSide, right: CapturedSide): boolean {
  if (left.binary !== undefined || right.binary !== undefined) {
    return (
      left.binary !== undefined &&
      right.binary !== undefined &&
      left.binary.size === right.binary.size &&
      left.binary.hash === right.binary.hash
    )
  }
  return left.content === right.content
}

async function validateWorkingTreeFile(path: string, root: string): Promise<string> {
  const absolutePath = resolve(root, path)
  const pathWithinRoot = relative(root, absolutePath)
  if (isAbsolute(pathWithinRoot) || pathWithinRoot.startsWith('..')) {
    throw new Error(`Git path escapes the repository: ${path}`)
  }

  const file = await lstat(absolutePath)
  if (file.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`)
  if (!file.isFile()) throw new Error(`Non-file Git paths are not supported: ${path}`)

  return absolutePath
}

async function workingTreeMode(path: string, root: string): Promise<DraftFile['newMode']> {
  const file = await lstat(resolve(root, path))
  return (file.mode & 0o100) === 0 ? '100644' : '100755'
}

async function gitFile(commit: string, path: string, root: string): Promise<CapturedSide> {
  return decodeFile(await gitBytes(['show', `${commit}:${path}`], root))
}

async function indexFile(path: string, root: string): Promise<CapturedSide> {
  return decodeFile(await gitBytes(['show', `:${path}`], root))
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
  if (bytes.includes(0)) throw new Error(`Unexpected binary output from ${label}`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`File is not valid UTF-8: ${label}`)
  }
}

function decodeFile(bytes: Uint8Array): CapturedSide {
  if (isBinary(bytes)) {
    return { content: '', binary: { size: bytes.byteLength, hash: hashBytes(bytes) } }
  }
  return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}

// A file is binary when it has a NUL byte or its bytes are not valid UTF-8, matching how the
// rest of Diffwalk decides that a side cannot be shown as text.
function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return false
  } catch {
    return true
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
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
    changes.push({
      kind: kind!,
      path,
      oldPath,
      oldMode: oldMode!,
      newMode: newMode!,
    })
  }

  return changes
}

function requireField(value: string | undefined, context: string): string {
  if (value === undefined) throw new Error(`Malformed git output after ${context}`)
  return value
}
