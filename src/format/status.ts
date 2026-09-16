import type { FileStatus } from './types'

export type MovedStatus = 'moved-to-excluded' | 'moved-from-excluded'
export type ChangeSide = 'old' | 'new'

// A rename crossing a literal exclusion boundary keeps one side. The excluded side is the
// side the move left behind or moved to, so the status names which one was omitted.
export function excludedSide(status: FileStatus): ChangeSide | undefined {
  if (status === 'moved-to-excluded') return 'new'
  if (status === 'moved-from-excluded') return 'old'
  return undefined
}

export function isMovedStatus(status: FileStatus): status is MovedStatus {
  return excludedSide(status) !== undefined
}

export function movedStatusLabel(status: FileStatus): string | undefined {
  const side = excludedSide(status)
  if (side === undefined) return undefined
  return side === 'new' ? 'Moved to excluded path' : 'Moved from excluded path'
}

export function movedPathLabel(status: FileStatus, path: string, excludedPath: string): string {
  return excludedSide(status) === 'new' ? `${path} → ${excludedPath}` : `${excludedPath} → ${path}`
}
