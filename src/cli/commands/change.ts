import { captureInput, readCapture, type CaptureOptions } from '../../authoring/input'
import { coordinates } from '../output'

export async function changeCommand(id: string, options: CaptureOptions): Promise<void> {
  const capture = await readCapture(await captureInput(options))
  const change = capture.changes.find((candidate) => candidate.id === id)
  if (!change) throw new Error(`Unknown change ID: ${id}`)
  console.log(`${change.id}  ${change.path}  ${coordinates(change)}`)
  console.log('before:')
  process.stdout.write(change.before)
  if (!change.before.endsWith('\n')) console.log()
  console.log('after:')
  process.stdout.write(change.after)
  if (!change.after.endsWith('\n')) console.log()
}
