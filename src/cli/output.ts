import type { ChangeBlock, ChangeSide } from '../format/types'

export function changeLine(change: ChangeBlock): string {
  if (change.kind === 'binary') {
    return `${change.id}  ${change.path}  binary ${change.status} before ${sideSize(change.before)} → after ${sideSize(change.after)}`
  }
  return `${change.id}  ${change.path}  ${coordinates(change)}`
}

export function binarySideLine(label: 'before' | 'after', side: ChangeSide | undefined): string {
  return `${label}: ${binaryMetadata(side)}`
}

export function binaryMetadata(side: ChangeSide | undefined): string {
  return side === undefined ? 'absent' : `${side.kind} · ${side.size} B · sha256 ${side.hash}`
}

function sideSize(side: ChangeSide | undefined): string {
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
