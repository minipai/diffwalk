import { z } from 'zod'
import { captureInput, captureOptionsSchema, readCapture, shortId } from '../../authoring/input'
import { changeLine } from '../output'

export const changesOptionsSchema = captureOptionsSchema.extend({
  json: z.boolean().optional(),
})
type ChangesOptions = z.infer<typeof changesOptionsSchema>

export async function changesCommand(options: ChangesOptions): Promise<void> {
  const capture = await readCapture(await captureInput(options))
  if (options.json === true) {
    console.log(JSON.stringify({ captureId: capture.captureId, changes: capture.changes }, null, 2))
    return
  }
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  console.log(
    `${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`,
  )
  for (const change of capture.changes) console.log(changeLine(change))
}
