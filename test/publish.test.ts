import { afterEach, describe, expect, test } from 'bun:test'
import type { ExplainDocument } from '../src/format'
import { publishDocument, reportService, unpublishDocument } from '../src/publish'

const originalFetch = globalThis.fetch
const originalEnvironment = { ...process.env }

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ['DIFFWALK_SERVICE_URL']) {
    const previous = originalEnvironment[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

const document: ExplainDocument = {
  formatVersion: 1,
  title: 'A change set',
  summary: '',
  source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
  sections: [
    {
      title: 'A section',
      steps: [
        {
          text: 'Text.',
          diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
        },
      ],
    },
  ],
}

interface Call {
  url: string
  method: string
  headers: Headers
  body: string
}

function stubFetch(response: () => Response): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return response()
  }) as typeof fetch
  return calls
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('reportService', () => {
  test('falls back to the hosted service, then the environment, then the flag', () => {
    delete process.env['DIFFWALK_SERVICE_URL']
    expect(reportService(undefined)).toBe('https://review.diffwalk.dev')

    process.env['DIFFWALK_SERVICE_URL'] = 'https://reports.example.test'
    expect(reportService(undefined)).toBe('https://reports.example.test')
    expect(reportService('https://explicit.example.test')).toBe('https://explicit.example.test')
  })

  test('keeps only the origin and rejects plaintext and malformed URLs', () => {
    expect(reportService('https://reports.example.test/some/path?x=1')).toBe(
      'https://reports.example.test',
    )
    expect(() => reportService('http://reports.example.test')).toThrow('over HTTPS')
    expect(() => reportService('not a url')).toThrow('Not a valid report service URL')
  })

  test('a local service may be reached without TLS for development', () => {
    expect(reportService('http://localhost:8787')).toBe('http://localhost:8787')
    expect(reportService('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
  })
})

describe('publishDocument', () => {
  test('sends the document as anonymous JSON and returns the report', async () => {
    const calls = stubFetch(() => json(201, { id: 'abc', revocationToken: 'revoke-me' }))

    const published = await publishDocument(document, 'https://s.test')

    expect(published).toEqual({
      id: 'abc',
      url: 'https://s.test/r/abc',
      revocationToken: 'revoke-me',
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call!.url).toBe('https://s.test/api/reports')
    expect(call!.method).toBe('POST')
    expect(call!.headers.get('authorization')).toBeNull()
    expect(call!.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(call!.body)).toEqual(document)
  })

  test("a rejection surfaces the service's own explanation", async () => {
    stubFetch(() => json(413, { error: 'A report document may not exceed 1048576 bytes' }))

    await expect(publishDocument(document, 'https://s.test')).rejects.toThrow(
      'Could not publish the report: 413 A report document may not exceed 1048576 bytes',
    )
  })

  test('a rejection without a problem document still reports the status', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502, statusText: 'Bad Gateway' }))

    await expect(publishDocument(document, 'https://s.test')).rejects.toThrow('502')
  })

  test('a response missing the expected fields is refused', async () => {
    stubFetch(() => json(201, { id: 'abc' }))

    await expect(publishDocument(document, 'https://s.test')).rejects.toThrow(
      'does not understand',
    )
  })

  test('the link is built from the service that was asked, not from the response', async () => {
    stubFetch(() =>
      json(201, { id: 'abc', revocationToken: 'revoke-me', url: 'https://attacker.test/r/abc' }),
    )

    const published = await publishDocument(document, 'https://s.test')

    expect(published.url).toBe('https://s.test/r/abc')
  })
})

describe('unpublishDocument', () => {
  test('deletes the report with its revocation token', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))

    await unpublishDocument('abc', 'https://s.test', 'revoke-me')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://s.test/api/reports/abc')
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer revoke-me')
  })

  test('a report ID is escaped rather than pasted into the path', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))

    await unpublishDocument('../secret', 'https://s.test', 'revoke-me')

    expect(calls[0]!.url).toBe('https://s.test/api/reports/..%2Fsecret')
  })

  test('a refused revocation surfaces the reason', async () => {
    stubFetch(() => json(403, { error: 'That credential does not revoke this report' }))

    await expect(unpublishDocument('abc', 'https://s.test', 'wrong')).rejects.toThrow(
      'Could not remove the report: 403 That credential does not revoke this report',
    )
  })
})
