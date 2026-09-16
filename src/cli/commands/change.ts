import { z } from 'zod'
import type { BinaryChangeBlock, ChangeBlock, ExplainCapture, TextChangeBlock } from '../../format/types'
import { excludedSide } from '../../format/status'
import { captureInput, readCapture } from '../input'
import { binarySideLine, changePathLabel, changeStatusLabel, coordinates } from '../output'

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
  if (change.kind === 'binary') {
    printBinaryChange(change)
    return
  }
  printTextChange(change)
}

function printBinaryChange(change: BinaryChangeBlock): void {
  const excluded = excludedSide(change.status)
  process.stdout.write(`${change.id}  ${changePathLabel(change)}  ${changeStatusLabel(change.status)}
modes: ${change.oldMode} → ${change.newMode}
${binarySideLine('before', change.before, excluded === 'old')}
${binarySideLine('after', change.after, excluded === 'new')}
`)
}

function printTextChange(change: TextChangeBlock): void {
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
