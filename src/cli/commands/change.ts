import { z } from 'zod'
import type { ChangeBlock, ExplainCapture } from '../../format/types'
import { captureInput, readCapture } from '../input'
import { coordinates } from '../output'

const changeOptionsSchema = z.object({
  input: z.string().optional(),
})

export async function printChange(changeId: string, options: z.input<typeof changeOptionsSchema>): Promise<void> {
  const { input } = changeOptionsSchema.parse(options)
  const capture = await loadCapture(input)
  const change = findChange(capture, changeId)
  printChangeDetails(change)
}

async function loadCapture(input: string | undefined): Promise<ExplainCapture> {
  return readCapture(await captureInput({ input }))
}

function findChange(capture: ExplainCapture, changeId: string): ChangeBlock {
  const change = capture.changes.find((candidate) => candidate.id === changeId)
  if (!change) throw new Error(`Unknown change ID: ${changeId}`)
  return change
}

function printChangeDetails(change: ChangeBlock): void {
  // The template supplies one final newline for each block.
  const before = change.before.endsWith('\n') ? change.before.slice(0, -1) : change.before
  const after = change.after.endsWith('\n') ? change.after.slice(0, -1) : change.after
  process.stdout.write(`${change.id}  ${change.path}  ${coordinates(change)}
before:
${before}
after:
${after}
`)
}
