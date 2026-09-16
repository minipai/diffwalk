import type { ChangeBlock, ChangeSide, FileStatus } from '../format/types'
import { excludedSide, movedPathLabel, movedStatusLabel } from '../format/status'

export function changeLine(change: ChangeBlock): string {
  if (change.kind === 'binary') {
    return `${change.id}  ${changePathLabel(change)}  ${changeStatusLabel(change.status)} before ${sideSize(change.before, excludedSide(change.status) === 'old')} → after ${sideSize(change.after, excludedSide(change.status) === 'new')}`
  }
  return `${change.id}  ${change.path}  ${coordinates(change)}`
}

export function changePathLabel(change: {
  path: string
  oldPath?: string
  excludedPath?: string
  status: FileStatus
}): string {
  if (change.excludedPath !== undefined) {
    return movedPathLabel(change.status, change.path, change.excludedPath)
  }
  return change.oldPath !== undefined && change.oldPath !== change.path
    ? `${change.oldPath} → ${change.path}`
    : change.path
}

export function changeStatusLabel(status: FileStatus): string {
  return movedStatusLabel(status) ?? `binary ${status}`
}

export function binarySideLine(label: 'before' | 'after', side: ChangeSide | undefined, excluded = false): string {
  return `${label}: ${excluded ? 'excluded' : binaryMetadata(side)}`
}

export function binaryMetadata(side: ChangeSide | undefined): string {
  return side === undefined ? 'absent' : `${side.kind} · ${side.size} B · sha256 ${side.hash}`
}

function sideSize(side: ChangeSide | undefined, excluded: boolean): string {
  if (excluded) return 'excluded'
  return side === undefined ? 'absent' : `${side.size} B`
}

export function coordinates(change: {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}): string {
  return `old ${change.oldStart}:${change.oldCount} → new ${change.newStart}:${change.newCount} (+${change.newCount} −${change.oldCount})`
}
