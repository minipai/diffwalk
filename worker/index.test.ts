import { beforeEach, describe, expect, test } from 'bun:test'
import type { ExplainDocument } from '../src/format'
import worker, { type Env } from './index'

interface StoredObject {
  body: string
  customMetadata: Record<string, string>
}

class FakeBucket {
  readonly objects = new Map<string, StoredObject>()
  failReads = false

  async put(
    key: string,
    value: string,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<void> {
    this.objects.set(key, { body: value, customMetadata: options?.customMetadata ?? {} })
  }

  async get(key: string) {
    if (this.failReads) throw new Error('the bucket is unreachable')
    const object = this.objects.get(key)
    if (!object) return null
    return {
      body: new Response(object.body).body,
      customMetadata: object.customMetadata,
      json: async () => JSON.parse(object.body) as unknown,
    }
  }

  async head(key: string) {
    const object = this.objects.get(key)
    return object ? { customMetadata: object.customMetadata } : null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

let bucket: FakeBucket
let env: Env

beforeEach(() => {
  bucket = new FakeBucket()
  env = {
    REPORTS: bucket as unknown as R2Bucket,
    ASSETS: {
      fetch: async () => new Response('static asset', { status: 200 }),
    } as unknown as Fetcher,
  }
})

function simplePatch(oldLine = 'old', newLine = 'new'): string {
  return [
    'diff --git a/example.ts b/example.ts',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -1 +1 @@',
    `-${oldLine}`,
    `+${newLine}`,
    '',
  ].join('\n')
}

function document(titles: string[] = ['A section']): ExplainDocument {
  return {
    formatVersion: 1,
    source: {
      kind: 'working-tree',
      capturedAt: '2026-08-28T00:00:00.000Z',
      from: { revision: 'HEAD', commit: '0123456789abcdef' },
    },
    sections: titles.map((title, index) => ({
      explain: { title, body: `Body for ${title}.` },
      diff: simplePatch(`old${index}`, `new${index}`),
    })),
  }
}

function publishRequest(body: unknown): Request {
  return new Request('https://reports.example/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function publish(body: unknown = document()) {
  const response = await worker.fetch(publishRequest(body), env)
  const value = (await response.json()) as { id: string; revocationToken: string }
  return { response, ...value }
}

function read(id: string): Request {
  return new Request(`https://reports.example/r/${id}`)
}

function revokeRequest(id: string, token: string): Request {
  return new Request(`https://reports.example/api/reports/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
}

describe('publishing', () => {
  test('an anonymous document returns an unguessable ID and stores only the document', async () => {
    const { response, id, revocationToken } = await publish()

    expect(response.status).toBe(201)
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(revocationToken.length).toBeGreaterThan(20)

    expect([...bucket.objects.keys()]).toEqual([`reports/${id}.json`])
    const stored = JSON.parse(bucket.objects.get(`reports/${id}.json`)!.body) as ExplainDocument
    expect(stored).toEqual(document())
    expect(JSON.stringify(stored)).not.toContain('captureId')
  })

  test('the revocation token is stored only as a digest', async () => {
    const { id, revocationToken } = await publish()
    const metadata = bucket.objects.get(`reports/${id}.json`)!.customMetadata

    expect(metadata['revocation']).toBeDefined()
    expect(metadata['revocation']).not.toBe(revocationToken)
    expect(JSON.stringify(metadata)).not.toContain(revocationToken)
  })

  test('report IDs cannot be predicted from neighbouring reports', async () => {
    const ids = new Set<string>()
    for (let index = 0; index < 8; index++) ids.add((await publish()).id)

    expect(ids.size).toBe(8)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  test('non-JSON content types, invalid JSON, and wrong shapes are rejected', async () => {
    const form = new Request('https://reports.example/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    })

    expect((await worker.fetch(form, env)).status).toBe(415)
    expect((await worker.fetch(publishRequest('{not json'), env)).status).toBe(400)
    expect((await worker.fetch(publishRequest({ formatVersion: 2 }), env)).status).toBe(400)
    expect((await worker.fetch(publishRequest({ sections: [] }), env)).status).toBe(400)
    expect(bucket.objects.size).toBe(0)
  })

  test('an oversized body is rejected without creating an object', async () => {
    const huge = document()
    huge.sections[0]!.explain.body = 'x'.repeat(1024 * 1024 + 1)
    const response = await worker.fetch(publishRequest(huge), env)

    expect(response.status).toBe(413)
    expect(bucket.objects.size).toBe(0)
  })

  test('an oversized body without a content-length header is still rejected', async () => {
    const chunk = 'y'.repeat(64 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (let index = 0; index < 20; index++) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    const request = new Request('https://reports.example/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error duplex is required for a streamed request body
      duplex: 'half',
    })

    expect((await worker.fetch(request, env)).status).toBe(413)
    expect(bucket.objects.size).toBe(0)
  })

  test('the response never echoes a link built from the request Host header', async () => {
    const spoofed = new Request('https://attacker.example/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document()),
    })

    const body = await (await worker.fetch(spoofed, env)).text()

    expect(body).not.toContain('attacker.example')
    expect(body).not.toContain('http')
  })

  test('the endpoint accepts POST only', async () => {
    const response = await worker.fetch(
      new Request('https://reports.example/api/reports', { method: 'PUT' }),
      env,
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})

describe('reading a report', () => {
  test('renders the sections in order with source provenance and linked assets', async () => {
    const { id } = await publish(document(['First section', 'Second section']))
    const response = await worker.fetch(read(id), env)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')

    const first = html.indexOf('First section')
    const second = html.indexOf('Second section')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(html).toContain('<dt>From</dt><dd>HEAD <code>0123456789abcdef</code></dd>')
    expect(html).toContain('<dt>To</dt><dd>Working tree</dd>')

    expect(html).toContain('<link rel="stylesheet" href="/report.css">')
    expect(html).toContain('<script src="/report-client.js" defer></script>')
    expect(html).not.toContain('<style>')
  })

  test('the report origin sets a policy that forbids inline scripts and outbound connections', async () => {
    const { id } = await publish()
    const response = await worker.fetch(read(id), env)
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('repeated reads never mutate the stored report', async () => {
    const { id } = await publish()
    const before = bucket.objects.get(`reports/${id}.json`)!.body

    await worker.fetch(read(id), env)
    await worker.fetch(read(id), env)

    expect(bucket.objects.get(`reports/${id}.json`)!.body).toBe(before)
    expect(bucket.objects.size).toBe(1)
  })

  test('missing, malformed, and unavailable reports are told apart without leaking keys', async () => {
    const { id } = await publish()

    const unknown = await worker.fetch(read('AAAAAAAAAAAAAAAAAAAAAA'), env)
    expect(unknown.status).toBe(404)
    expect(await unknown.text()).not.toContain('reports/')

    // An encoded slash survives URL normalisation and reaches the route, so the ID shape is
    // what keeps a path from ever becoming an object key.
    const traversal = await worker.fetch(read('..%2F..%2Fsecret'), env)
    expect(traversal.status).toBe(404)
    expect(await traversal.text()).not.toContain('reports/')

    const wrongShape = await worker.fetch(read('short'), env)
    expect(wrongShape.status).toBe(404)

    bucket.objects.get(`reports/${id}.json`)!.body = '{"formatVersion":9}'
    const unreadable = await worker.fetch(read(id), env)
    expect(unreadable.status).toBe(500)
    expect(await unreadable.text()).not.toContain('reports/')

    bucket.failReads = true
    const unavailable = await worker.fetch(read(id), env)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).toContain('temporarily')
  })

  test('the JSON endpoint returns the stored document unchanged', async () => {
    const { id } = await publish()
    const response = await worker.fetch(
      new Request(`https://reports.example/api/reports/${id}`),
      env,
    )

    expect(response.status).toBe(200)
    expect((await response.json()) as ExplainDocument).toEqual(document())
  })
})

describe('revoking a report', () => {
  test('the revocation token removes the report and its link stops working', async () => {
    const { id, revocationToken } = await publish()

    const revoked = await worker.fetch(revokeRequest(id, revocationToken), env)
    expect(revoked.status).toBe(204)
    expect(bucket.objects.size).toBe(0)

    expect((await worker.fetch(read(id), env)).status).toBe(404)
  })

  test('a token cannot revoke a different report', async () => {
    const first = await publish()
    const second = await publish()

    const crossed = await worker.fetch(revokeRequest(second.id, first.revocationToken), env)

    expect(crossed.status).toBe(403)
    expect(bucket.objects.size).toBe(2)
  })

  test('a missing token, an unknown report, and a wrong token are told apart', async () => {
    const { id } = await publish()

    const noToken = await worker.fetch(
      new Request(`https://reports.example/api/reports/${id}`, { method: 'DELETE' }),
      env,
    )
    expect(noToken.status).toBe(401)

    const unknown = await worker.fetch(
      revokeRequest('AAAAAAAAAAAAAAAAAAAAAA', 'whatever'),
      env,
    )
    expect(unknown.status).toBe(404)

    const wrong = await worker.fetch(revokeRequest(id, 'not-the-revocation-token'), env)
    expect(wrong.status).toBe(403)

    expect(bucket.objects.size).toBe(1)
  })
})

describe('everything else', () => {
  test('unknown API paths answer as JSON and other paths fall through to static assets', async () => {
    const api = await worker.fetch(new Request('https://reports.example/api/nope'), env)
    expect(api.status).toBe(404)
    expect(api.headers.get('content-type')).toBe('application/json; charset=utf-8')

    const asset = await worker.fetch(new Request('https://reports.example/report.css'), env)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe('static asset')
  })
})
