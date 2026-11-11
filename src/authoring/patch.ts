import { formatPatch, parsePatch, type StructuredPatch, type StructuredPatchHunk } from 'diff'
import type { DraftFile, TextChangeBlock } from '../format/types'

// This module only needs the Git patch text and the draft file metadata. It deliberately
// avoids snapshots so the same parser and selected-step builder can run in a browser.
// The browser-safe builder needs the file's identity and status, never its snapshot.
export type PatchFileMetadata = Pick<
  DraftFile,
  'path' | 'oldPath' | 'status' | 'oldMode' | 'newMode'
>

export interface ParsedPatchFile {
  path: string
  oldPath?: string
  isCreate: boolean
  isDelete: boolean
  isRename: boolean
  isBinary: boolean
  hunks: ParsedPatchHunk[]
  blocks: ParsedPatchBlock[]
}

export interface ParsedPatchHunk {
  rows: PatchRow[]
}

export interface ParsedPatchBlock {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  before: string
  after: string
}

interface PatchRow {
  kind: 'context' | 'remove' | 'add'
  text: string
  oldLine: number
  newLine: number
  block?: ParsedPatchBlock
}

interface BuildRow {
  kind: 'same' | 'del' | 'add'
  text: string
  oldLine: number
}

export function parseGitPatch(patch: string): ParsedPatchFile[] {
  return parsePatch(patch).map(parseFile)
}

export function changeBlocksFromPatch(file: ParsedPatchFile): Omit<TextChangeBlock, 'kind' | 'id' | 'path'>[] {
  return file.blocks.map((block) => ({
    oldStart: block.oldStart,
    oldCount: block.oldCount,
    newStart: block.newStart,
    newCount: block.newCount,
    before: block.before,
    after: block.after,
  }))
}

// Build the patch for one step from the parsed Git patch. A selected block keeps its
// removals and additions. An unselected block keeps its old lines as context and drops its
// new lines, which is exactly what the step would show if only the selected blocks applied.
export function buildStepPatch(
  file: PatchFileMetadata,
  parsed: ParsedPatchFile,
  changes: TextChangeBlock[],
): string {
  const selected = selectedBlocks(parsed, changes)
  const hunks: StructuredPatchHunk[] = []
  let delta = 0

  for (const hunk of parsed.hunks) {
    const rows: BuildRow[] = []
    for (const row of hunk.rows) {
      if (row.kind === 'context') {
        rows.push({ kind: 'same', text: row.text, oldLine: row.oldLine })
      } else if (row.kind === 'remove') {
        rows.push({
          kind: row.block !== undefined && selected.has(row.block) ? 'del' : 'same',
          text: row.text,
          oldLine: row.oldLine,
        })
      } else if (row.block !== undefined && selected.has(row.block)) {
        rows.push({ kind: 'add', text: row.text, oldLine: row.oldLine })
      }
    }

    for (const [start, end] of changedRanges(rows)) {
      const first = rows[start]!
      const range = rows.slice(start, end)
      const oldStart = first.oldLine
      const oldLines = range.filter((row) => row.kind !== 'add').length
      const newLines = range.filter((row) => row.kind !== 'del').length
      hunks.push({
        oldStart,
        oldLines,
        newStart: oldStart + delta,
        newLines,
        lines: range.flatMap(renderRow),
      })
      delta += newLines - oldLines
    }
  }

  return formatFilePatch(file, hunks)
}

function parseFile(file: ReturnType<typeof parsePatch>[number]): ParsedPatchFile {
  const oldPath = gitPath(file.oldFileName)
  const newPath = gitPath(file.newFileName)
  const path = newPath ?? oldPath
  if (path === undefined) throw new Error('Patch entry has no file path')

  const parsed: ParsedPatchFile = {
    path,
    ...(file.isCreate || oldPath === undefined ? {} : { oldPath }),
    isCreate: file.isCreate ?? false,
    isDelete: file.isDelete ?? false,
    isRename: file.isRename ?? false,
    isBinary: file.isBinary ?? false,
    hunks: [],
    blocks: [],
  }

  for (const hunk of file.hunks) {
    parsed.hunks.push(parseHunk(hunk, parsed.blocks))
  }

  return parsed
}

function parseHunk(
  hunk: StructuredPatchHunk,
  blocks: ParsedPatchBlock[],
): ParsedPatchHunk {
  const rows: PatchRow[] = []
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  let block: ParsedPatchBlock | undefined

  for (let index = 0; index < hunk.lines.length; index++) {
    const line = hunk.lines[index]!
    if (line.startsWith('\\')) continue

    const marker = line === '' ? ' ' : line[0]
    if (marker !== ' ' && marker !== '-' && marker !== '+') {
      throw new Error(`Unexpected patch line in hunk at ${hunk.oldStart}: ${line}`)
    }

    const kind = marker === ' ' ? 'context' : marker === '-' ? 'remove' : 'add'
    const noNewline = hunk.lines[index + 1]?.startsWith('\\ No newline at end of file') ?? false
    const text = `${line.slice(1)}${noNewline ? '' : '\n'}`
    const row: PatchRow = { kind, text, oldLine, newLine }

    if (kind === 'context') {
      block = undefined
      oldLine++
      newLine++
    } else {
      if (block === undefined) {
        block = {
          oldStart: oldLine,
          oldCount: 0,
          newStart: newLine,
          newCount: 0,
          before: '',
          after: '',
        }
        blocks.push(block)
      }
      row.block = block
      if (kind === 'remove') {
        block.before += text
        block.oldCount++
        oldLine++
      } else {
        block.after += text
        block.newCount++
        newLine++
      }
    }

    rows.push(row)
  }

  return { rows }
}

function selectedBlocks(
  parsed: ParsedPatchFile,
  changes: TextChangeBlock[],
): Set<ParsedPatchBlock> {
  const selected = new Set<ParsedPatchBlock>()

  for (const change of changes) {
    // A pure rename or an empty add/delete has a placeholder block with no changed lines.
    if (
      change.oldCount === 0 &&
      change.newCount === 0 &&
      change.before === '' &&
      change.after === ''
    ) {
      continue
    }

    const match = parsed.blocks.find(
      (block) => block.oldStart === change.oldStart && block.newStart === change.newStart,
    )
    if (
      match === undefined ||
      match.oldCount !== change.oldCount ||
      match.newCount !== change.newCount ||
      match.before !== change.before ||
      match.after !== change.after
    ) {
      throw new Error(`Change block no longer matches captured file content: ${change.id}`)
    }
    selected.add(match)
  }

  return selected
}

function changedRanges(rows: BuildRow[]): [number, number][] {
  const changed = rows.flatMap((row, index) => (row.kind === 'same' ? [] : [index]))
  if (changed.length === 0) return []

  const ranges: [number, number][] = []
  let start = Math.max(0, changed[0]! - 3)
  let end = Math.min(rows.length, changed[0]! + 4)

  for (const index of changed.slice(1)) {
    if (index - 3 <= end) {
      end = Math.min(rows.length, index + 4)
    } else {
      ranges.push([start, end])
      start = Math.max(0, index - 3)
      end = Math.min(rows.length, index + 4)
    }
  }

  ranges.push([start, end])
  return ranges
}

function renderRow(row: BuildRow): string[] {
  const marker = row.kind === 'same' ? ' ' : row.kind === 'del' ? '-' : '+'
  if (row.text.endsWith('\n')) return [`${marker}${row.text.slice(0, -1)}`]
  return [`${marker}${row.text}`, '\\ No newline at end of file']
}

function formatFilePatch(file: PatchFileMetadata, hunks: StructuredPatchHunk[]): string {
  const patch: StructuredPatch = {
    oldFileName: file.status === 'added' ? '/dev/null' : `a/${file.oldPath ?? file.path}`,
    newFileName: file.status === 'deleted' ? '/dev/null' : `b/${file.path}`,
    oldHeader: undefined,
    newHeader: undefined,
    hunks,
    isGit: true,
    isCreate: file.status === 'added',
    isDelete: file.status === 'deleted',
    isRename: file.status === 'renamed',
  }
  if (file.oldMode !== file.newMode) {
    patch.oldMode = file.oldMode
    patch.newMode = file.newMode
  }

  const formatted = formatPatch(patch)
  if (!patch.isRename || hunks.length > 0) return formatted
  return formatted.replace('\nrename from ', '\nsimilarity index 100%\nrename from ')
}

function gitPath(fileName: string | undefined): string | undefined {
  if (fileName === undefined || fileName === '/dev/null') return undefined
  return fileName.replace(/^[ab]\//, '')
}
