import { explainDocumentSchema } from '../src/format'
import { faviconSvg } from '../src/favicon'
import { renderHostedReport } from '../src/report-shell'
import {
  bearerToken,
  createReportId,
  createRevocationToken,
  hashToken,
  isReportId,
  maxDocumentBytes,
  reportKey,
  secretsMatch,
} from './reports'

export interface Env extends Cloudflare.Env {}

const hostedAssets = { stylesHref: '/report.css', clientSrc: '/report-client.js' }

// Reports carry authored HTML fragments, so the origin itself is kept powerless: no inline
// scripts, no outbound connections, and nothing privileged to reach on this domain. Inline
// styles stay allowed because the diff renderer sets them while it mounts.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

// A published report never changes, but revoking one has to take effect quickly, so reads are
// cached briefly rather than declared immutable.
const reportCacheControl = 'public, max-age=60'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname

    if (path === '/favicon.svg') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD')
      return new Response(request.method === 'HEAD' ? null : faviconSvg, {
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        },
      })
    }

    if (path === '/api/reports') {
      if (request.method !== 'POST') return methodNotAllowed('POST')
      return publishReport(request, env)
    }

    const apiReport = /^\/api\/reports\/([^/]+)$/.exec(path)
    if (apiReport) {
      const id = apiReport[1]!
      if (request.method === 'GET') return readReport(id, env)
      if (request.method === 'DELETE') return revokeReport(id, request, env)
      return methodNotAllowed('GET, DELETE')
    }

    const reader = /^\/r\/([^/]+)$/.exec(path)
    if (reader) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET')
      return showReport(reader[1]!, env)
    }

    if (path.startsWith('/api/')) return problem(404, 'No such endpoint')

    return env.ASSETS.fetch(request)
  },
}

async function publishReport(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return problem(415, 'Send the document as application/json')
  }

  const body = await readBoundedBody(request)
  if (body === null) {
    return problem(413, `A report document may not exceed ${maxDocumentBytes} bytes`)
  }

  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return problem(400, 'The request body is not valid JSON')
  }

  const parsed = explainDocumentSchema.safeParse(value)
  if (!parsed.success) {
    return problem(400, 'The request body is not a version 1 ExplainDocument')
  }

  const id = createReportId()
  const revocationToken = createRevocationToken()
  await env.REPORTS.put(reportKey(id), JSON.stringify(parsed.data), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { revocation: await hashToken(revocationToken) },
  })

  // The link is built by the caller, which knows the origin it reached. Deriving it here would
  // mean trusting the request's Host header.
  return json(201, { id, revocationToken })
}

async function readReport(id: string, env: Env): Promise<Response> {
  if (!isReportId(id)) return problem(404, 'No such report')
  const object = await env.REPORTS.get(reportKey(id))
  if (!object) return problem(404, 'No such report')
  return new Response(object.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': reportCacheControl,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function revokeReport(id: string, request: Request, env: Env): Promise<Response> {
  if (!isReportId(id)) return problem(404, 'No such report')
  const token = bearerToken(request)
  if (token === null) return problem(401, 'A revocation credential is required')

  const object = await env.REPORTS.head(reportKey(id))
  if (!object) return problem(404, 'No such report')

  const expected = object.customMetadata?.['revocation']
  if (expected === undefined || !secretsMatch(await hashToken(token), expected)) {
    return problem(403, 'That credential does not revoke this report')
  }

  await env.REPORTS.delete(reportKey(id))
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

async function showReport(id: string, env: Env): Promise<Response> {
  if (!isReportId(id)) return errorPage(404, 'No such report', 'This link does not name a report.')

  let object: R2ObjectBody | null
  try {
    object = await env.REPORTS.get(reportKey(id))
  } catch {
    return errorPage(
      503,
      'Report unavailable',
      'The report store is temporarily unreachable. Try again in a moment.',
    )
  }
  if (!object) {
    return errorPage(404, 'No such report', 'This report does not exist, or it has been revoked.')
  }

  let html: string
  try {
    const parsed = explainDocumentSchema.parse(await object.json())
    html = renderHostedReport(parsed, hostedAssets)
  } catch {
    return errorPage(
      500,
      'Report unreadable',
      'This report is stored in a form the reader cannot display.',
    )
  }

  return new Response(html, { headers: htmlHeaders(reportCacheControl) })
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxDocumentBytes) return null

  const body = request.body
  if (body === null) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxDocumentBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function htmlHeaders(cacheControl: string): Headers {
  return new Headers({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': contentSecurityPolicy,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'cache-control': cacheControl,
  })
}

function methodNotAllowed(allow: string): Response {
  return problem(405, `This endpoint accepts ${allow}`, { allow })
}

function problem(status: number, message: string, headers: HeadersInit = {}): Response {
  return json(status, { error: message }, headers)
}

function json(status: number, value: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  })
}

function errorPage(status: number, title: string, detail: string): Response {
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${title}</title>
<link rel="stylesheet" href="${hostedAssets.stylesHref}">
</head>
<body>
<header class="report-header"><h1>${title}</h1></header>
<main><p>${detail}</p></main>
</body>
</html>
`
  return new Response(page, { status, headers: htmlHeaders('no-store') })
}
