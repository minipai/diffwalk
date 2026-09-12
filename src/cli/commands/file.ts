import { z } from 'zod'
import type { DraftFile, ExplainCapture } from '../../format/types'
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
  process.stdout.write(before ? file.oldContent : file.newContent)
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
