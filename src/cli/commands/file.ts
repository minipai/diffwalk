import { z } from 'zod'
import type { BinarySide, DraftFile, ExplainCapture } from '../../format/types'
import { excludedSide } from '../../format/status'
import { captureInput, readCapture } from '../input'
import { UsageError } from '../usage'

const fileOptionsSchema = z.object({
  input: z.string().optional(),
  before: z.boolean().optional(),
  after: z.boolean().optional(),
})

export async function printFile(filePath: string, options: z.input<typeof fileOptionsSchema>): Promise<void> {
  const { input, before = false, after = false } = fileOptionsSchema.parse(options)
  validateFileSide(before, after)
  const capture = await readCapture(await captureInput({ input }))
  const file = findFile(capture, filePath)
  rejectExcludedSide(file, before ? 'old' : 'new')
  const side = before ? file.oldBinary : file.newBinary
  if (side !== undefined) {
    printBinarySide(file, before ? 'before' : 'after', side)
    return
  }
  process.stdout.write(before ? file.oldContent : file.newContent)
}

// An excluded side was never read into the capture, so printing it would show an empty file
// instead of the omission it is.
function rejectExcludedSide(file: DraftFile, side: 'old' | 'new'): void {
  if (excludedSide(file.status) === side) {
    throw new UsageError(`The ${side === 'old' ? 'before' : 'after'} side of ${file.path} is excluded from this capture`)
  }
}

function validateFileSide(before: boolean, after: boolean): void {
  if (before === after) {
    throw new UsageError('Choose exactly one side with --before or --after')
  }
}

function findFile(capture: ExplainCapture, filePath: string): DraftFile {
  const file = capture.files.find((candidate) => candidate.path === filePath)
  if (!file) throw new Error(`Unknown file path: ${filePath}`)
  return file
}

// Binary bytes are never printed: the capture keeps only their identity, and this names it.
function printBinarySide(file: DraftFile, side: 'before' | 'after', binary: BinarySide): void {
  process.stdout.write(`${file.path}  binary  ${file.status}  ${side}
size: ${binary.size} B
sha256: ${binary.hash}
`)
}
