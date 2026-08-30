import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { shellStyles } from '../src/report-shell'

const root = resolve(import.meta.dir, '..')
const publicDirectory = join(root, 'worker', 'public')
await mkdir(publicDirectory, { recursive: true })

await writeFile(join(publicDirectory, 'report.css'), shellStyles.trimStart())

const built = await Bun.build({
  entrypoints: [join(root, 'src', 'report-client.ts')],
  target: 'browser',
  format: 'iife',
  minify: true,
})
const bundle = built.outputs[0]
if (!bundle) throw new Error('The report client bundle produced no output')
await writeFile(join(publicDirectory, 'report-client.js'), await bundle.text())

console.log(`Wrote report.css and report-client.js to ${publicDirectory}`)
