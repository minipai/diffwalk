import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

export interface FileDiffStats {
  additions: number
  deletions: number
}

export function parseSectionPatch(patch: string): FileDiffMetadata[] {
  const parsed = parsePatchFiles(patch, undefined, true)
  const files = parsed.flatMap((result) => result.files)
  if (files.length === 0) {
    throw new Error('The section patch contains no parseable file diffs')
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