import { z } from 'zod'
import type { ExplainCapture } from '../../format/types'
import { captureInput, readCapture, shortId } from '../input'
import { changeLine } from '../output'

const changesOptionsSchema = z.object({
  input: z.string().optional(),
  json: z.boolean().optional(),
})

export async function printChanges(options: z.input<typeof changesOptionsSchema>): Promise<void> {
  const { input, json = false } = changesOptionsSchema.parse(options)
  const capture = await readCapture(await captureInput({ input }))
  switch (json) {
    case true:
      console.log(JSON.stringify({ captureId: capture.captureId, changes: capture.changes }, null, 2))
      break
    case false:
      printCaptureChanges(capture)
      break
  }
}

function printCaptureChanges(capture: ExplainCapture): void {
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  const heading = `${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`
  const lines = capture.changes.map(changeLine)
  console.log([heading, ...lines].join('\n'))
}
