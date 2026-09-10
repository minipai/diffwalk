import { duplicatedChangeIds } from '../../authoring/capture'
import { materialize, shortId, type AuthoringOptions } from '../../authoring/input'

export async function checkCommand(options: AuthoringOptions): Promise<void> {
  const { capture, explanations, document } = await materialize(options)
  const fileCount = new Set(capture.files.map((file) => file.path)).size
  const steps = document.sections.reduce((total, section) => total + section.steps.length, 0)
  console.log(
    `OK: ${document.sections.length} sections and ${steps} steps cover ${capture.changes.length} of ${capture.changes.length} changes across ${fileCount} files · capture ${shortId(capture.captureId)}`,
  )
  // Showing a change twice is a legitimate way to build an argument, so it is reported
  // rather than rejected. Only an unexplained change fails the check.
  const repeated = duplicatedChangeIds(explanations)
  if (repeated.length > 0) {
    console.log(`${repeated.length} changes are shown more than once: ${repeated.join(', ')}`)
  }
  console.log('Next: `diffwalk view`, `diffwalk export html`, or `diffwalk publish`.')
}
