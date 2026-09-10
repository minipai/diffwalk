import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ReportPreview {
  url: string
  close: () => Promise<void>
}

export async function startReportPreview(html: string): Promise<ReportPreview> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end()
      return
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    if (path !== '/') {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    })
    response.end(html)
  })

  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((accept, reject) => {
        server.close((error) => (error ? reject(error) : accept()))
      }),
  }
}

export async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] }
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
  await new Promise<void>((accept, reject) => {
    child.once('error', reject)
    child.once('spawn', accept)
  })
  child.unref()
}
