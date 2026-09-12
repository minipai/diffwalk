import { renderReport } from '../src/report/render'
import { explainDocumentSchema } from '../src/format/schema'
import sample from '../fixtures/report-preview.json'

const document = explainDocumentSchema.parse(sample)

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? 4399),
  async fetch(request) {
    if (new URL(request.url).pathname !== '/') {
      return new Response('Not found', { status: 404 })
    }
    return previewReport()
  },
})

console.log(`Report preview: http://localhost:${server.port}/ (LAN: http://192.168.88.8:${server.port}/)`)

async function previewReport(): Promise<Response> {
  const build = await Bun.build({
    entrypoints: [new URL('../src/report/client.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'iife',
    minify: true,
  })
  if (!build.success) {
    console.error(build.logs)
    return new Response('Report client build failed', { status: 500 })
  }
  const clientBundle = await build.outputs[0]!.text()
  return new Response(renderReport(document, clientBundle), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
