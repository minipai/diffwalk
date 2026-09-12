import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { parsePatch } from 'diff'

export interface FileDiffStats {
  additions: number
  deletions: number
}

export function parseSectionPatch(patch: string): FileDiffMetadata[] {
  const parsed = parsePatchFiles(patch, undefined, true)
  const files = parsed.flatMap((result) => result.files)
  validatePatchFiles(files)
  const structured = parsePatch(patch)
  for (const [index, file] of files.entries()) {
    const source = structured[index]
    if (!source?.isRename || source.oldFileName === undefined || source.newFileName === undefined)
      continue
    file.prevName = source.oldFileName.replace(/^a\//, '')
    file.name = source.newFileName.replace(/^b\//, '')
    file.type = file.hunks.length === 0 ? 'rename-pure' : 'rename-changed'
  }
  return files
}

export function fileDiffStats(file: FileDiffMetadata): FileDiffStats {
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return { additions, deletions }
}

export function fileDiffLabel(file: FileDiffMetadata): string {
  return file.prevName && file.prevName !== file.name
    ? `${file.prevName} → ${file.name}`
    : file.name
}

function validatePatchFiles(files: FileDiffMetadata[]): void {
  if (files.length === 0) {
    throw new Error('The section patch contains no parseable file diffs')
  }
}
