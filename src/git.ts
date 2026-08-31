import { spawn } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { DraftFile } from './format'

export interface GitCapture {
  root: string
  baseCommit: string
  files: DraftFile[]
}

interface GitChange {
  kind: string
  path: string
  oldPath?: string
}

const supportedGitModes = new Set(['000000', '100644', '100755'])

export async function captureGitChanges(
  base = 'HEAD',
  cwd = process.cwd(),
): Promise<GitCapture> {
  const root = (await gitText(['rev-parse', '--show-toplevel'], cwd)).trim()
  const baseCommit = (
    await gitText(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], root)
  ).trim()
  const changes = parseGitChanges(
    await gitBytes(['diff', '--raw', '-z', '--find-renames', baseCommit, '--'], root),
  )
  const files: DraftFile[] = []

  for (const change of changes) {
    if (change.kind === 'R') {
      files.push({
        path: change.path,
        oldPath: change.oldPath,
        status: 'renamed',
        oldContent: await gitFile(baseCommit, change.oldPath!, root),
        newContent: await workingTreeFile(change.path, root),
      })
      continue
    }

    if (change.kind === 'M') {
      files.push({
        path: change.path,
        status: 'modified',
        oldContent: await gitFile(baseCommit, change.path, root),
        newContent: await workingTreeFile(change.path, root),
      })
    } else if (change.kind === 'A') {
      files.push({
        path: change.path,
        status: 'added',
        oldContent: '',
        newContent: await workingTreeFile(change.path, root),
      })
    } else if (change.kind === 'D') {
      files.push({
        path: change.path,
        status: 'deleted',
        oldContent: await gitFile(baseCommit, change.path, root),
        newContent: '',
      })
    } else {
      throw new Error(`Unsupported Git change status: ${change.kind}`)
    }
  }

  const knownPaths = new Set(files.map((file) => file.path))
  const untracked = splitNulls(
    await gitBytes(['ls-files', '--others', '--exclude-standard', '--exclude=.explain/', '-z'], root),
  )
  for (const path of untracked) {
    if (knownPaths.has(path)) continue
    files.push({
      path,
      status: 'added',
      oldContent: '',
      newContent: await workingTreeFile(path, root),
    })
  }

  return {
    root,
    baseCommit,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
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

  return decodeText(await readFile(absolutePath), path)
}

async function gitFile(commit: string, path: string, root: string): Promise<string> {
  return decodeText(await gitBytes(['show', `${commit}:${path}`], root), path)
}

async function gitText(args: string[], cwd: string): Promise<string> {
  return decodeText(await gitBytes(args, cwd), `git ${args[0]}`)
}

async function gitBytes(args: string[], cwd: string): Promise<Uint8Array> {
  const child = spawn('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
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
    if (oldMode !== '000000' && newMode !== '000000' && oldMode !== newMode) {
      throw new Error(`File mode changes are not supported: ${path}`)
    }
    if (
      (kind === 'A' && newMode !== '100644') ||
      (kind === 'D' && oldMode !== '100644')
    ) {
      throw new Error(`Executable file additions and deletions are not supported: ${path}`)
    }

    changes.push({ kind: kind!, path, oldPath })
  }

  return changes
}

function requireField(value: string | undefined, context: string): string {
  if (value === undefined) throw new Error(`Malformed git output after ${context}`)
  return value
}
