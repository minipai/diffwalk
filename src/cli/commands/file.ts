import { z } from 'zod'
import { captureInput, captureOptionsSchema, readCapture } from '../../authoring/input'
import { UsageError } from '../usage'

export const fileOptionsSchema = captureOptionsSchema.extend({
  before: z.boolean().optional(),
  after: z.boolean().optional(),
})
type FileOptions = z.infer<typeof fileOptionsSchema>

export async function fileCommand(path: string, options: FileOptions): Promise<void> {
  const before = options.before === true
  const after = options.after === true
  if (before === after) {
    throw new UsageError('Choose exactly one side with --before or --after')
  }
  const capture = await readCapture(await captureInput(options))
  const file = capture.files.find((candidate) => candidate.path === path)
  if (!file) throw new Error(`Unknown file path: ${path}`)
  process.stdout.write(before ? file.oldContent : file.newContent)
}
