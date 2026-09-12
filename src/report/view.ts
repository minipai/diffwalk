import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ReportPreview {
  url: string
  close: () => Promise<void>
}

export async function startReportPreview(html: string): Promise<ReportPreview> {
  const server = createServer((request, response) => serveReport(request, response, html))

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
  const command = browserCommand(url)
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
  await new Promise<void>((accept, reject) => {
    child.once('error', reject)
    child.once('spawn', accept)
  })
  child.unref()
}

function serveReport(request: IncomingMessage, response: ServerResponse, html: string): void {
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end()
    return
  }
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  switch (path) {
    case '/':
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      })
      response.end(html)
      break
    case '/favicon.ico':
      response.writeHead(204).end()
      break
    default:
      response.writeHead(404).end('Not found')
  }
}

function browserCommand(url: string): { file: string; args: string[] } {
  switch (process.platform) {
    case 'darwin':
      return { file: 'open', args: [url] }
    case 'win32':
      return { file: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
    default:
      return { file: 'xdg-open', args: [url] }
  }
}
