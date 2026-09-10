export function coordinates(change: {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}): string {
  return `old ${change.oldStart}:${change.oldCount} → new ${change.newStart}:${change.newCount} (+${change.newCount} −${change.oldCount})`
}

export function changeLine(change: {
  id: string
  path: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}): string {
  return `${change.id}  ${change.path}  ${coordinates(change)}`
}
