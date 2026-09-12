import { z } from 'zod'
import { duplicatedChangeIds } from '../../authoring/capture'
import { materialize, shortId, type MaterializedAuthoring } from '../input'

const checkOptionsSchema = z.object({
  input: z.string().optional(),
  explanations: z.string().optional(),
})

export async function checkReview(options: z.input<typeof checkOptionsSchema>): Promise<void> {
  const { input, explanations } = checkOptionsSchema.parse(options)
  const review = await materialize({ input, explanations })
  printCheckResult(review)
}

function printCheckResult({ capture, explanations, document }: MaterializedAuthoring): void {
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  const steps = document.sections.reduce((total, section) => total + section.steps.length, 0)
  const summary = `OK: ${document.sections.length} sections and ${steps} steps cover ${capture.changes.length} of ${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`
  // Showing a change twice is a legitimate way to build an argument, so it is reported
  // rather than rejected. Only an unexplained change fails the check.
  const repeated = duplicatedChangeIds(explanations)
  const lines = [summary]
  if (repeated.length > 0) {
    lines.push(`${repeated.length} changes are shown more than once: ${repeated.join(', ')}`)
  }
  lines.push('Next: `diffwalk view`, `diffwalk export html`, or `diffwalk publish`.')
  console.log(lines.join('\n'))
}
