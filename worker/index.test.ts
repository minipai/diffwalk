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
    title: 'A change set',
    summary: '',
    source: {
      kind: 'working-tree',
      capturedAt: '2026-08-28T00:00:00.000Z',
      from: { revision: 'HEAD', commit: '0123456789abcdef' },
    },
    sections: titles.map((title, index) => ({
      title,
      steps: [
        {
          text: `Text for ${title}.`,
          diff: simplePatch(`old${index}`, `new${index}`),
          changes: [`change-${String(index + 1).padStart(3, '0')}`],
        },
      ],
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

function updateRequest(id: string, token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) headers['authorization'] = `Bearer ${token}`
  return new Request(`https://reports.example/api/reports/${id}`, {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
    const { metadata, ...rest } = stored
    expect(rest).toEqual(document())
    expect(metadata?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(JSON.stringify(stored)).not.toContain('captureId')
  })

  test('stamps its own ISO 8601 publishedAt and overrides any claimed value', async () => {
    const claimed: ExplainDocument = {
      ...document(),
      metadata: { publishedAt: '1999-01-01T00:00:00.000Z' },
    }

    const { id } = await publish(claimed)
    const stored = JSON.parse(bucket.objects.get(`reports/${id}.json`)!.body) as ExplainDocument

    expect(stored.metadata?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(stored.metadata?.publishedAt).not.toBe('1999-01-01T00:00:00.000Z')
  })

  test('accepts explainedBy and publishedBy attribution but rejects unknown metadata keys', async () => {
    const attributed: ExplainDocument = {
      ...document(),
      metadata: { explainedBy: 'Claude Code', publishedBy: 'Art' },
    }

    const accepted = await publish(attributed)
    expect(accepted.response.status).toBe(201)
    const stored = JSON.parse(bucket.objects.get(`reports/${accepted.id}.json`)!.body) as ExplainDocument
    expect(stored.metadata).toMatchObject({ explainedBy: 'Claude Code', publishedBy: 'Art' })

    const invalid = structuredClone(attributed) as Record<string, any>
    invalid.metadata.extra = 'nope'
    expect((await worker.fetch(publishRequest(invalid), env)).status).toBe(400)
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

  test('strictly validates and stores optional captured change IDs on version 1 steps', async () => {
    const withChanges = document()

    const accepted = await publish(withChanges)
    expect(accepted.response.status).toBe(201)
    expect(JSON.parse(bucket.objects.get(`reports/${accepted.id}.json`)!.body)).toMatchObject(withChanges)

    const invalid = structuredClone(withChanges) as Record<string, any>
    invalid.sections[0].steps[0].changes = []
    expect((await worker.fetch(publishRequest(invalid), env)).status).toBe(400)
  })

  test('continues accepting version 1 documents published before captured change IDs', async () => {
    const legacy = document()
    delete legacy.sections[0]!.steps[0]!.changes

    const accepted = await publish(legacy)
    expect(accepted.response.status).toBe(201)
    expect(JSON.parse(bucket.objects.get(`reports/${accepted.id}.json`)!.body)).toMatchObject(legacy)
  })

  test('an oversized body is rejected without creating an object', async () => {
    const huge = document()
    huge.sections[0]!.steps[0]!.text = 'x'.repeat(1024 * 1024 + 1)
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
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,')
    expect(html).toContain('<script src="/report-client.js" defer></script>')
    expect(html).toContain('id="change-001" data-target-kind="change"')
    expect(html).not.toContain('data-copy-fragment')
    expect(html).toContain('<a class="permalink" href="#')
    expect(html).toMatch(/<a class="section-title-text" href="#[^"]+">First section<\/a>/)
    expect(html).not.toContain('<style>')
  })

  test('renders the author, publisher, and service-stamped time as attribution', async () => {
    const { id } = await publish({
      ...document(['Attributed']),
      metadata: { explainedBy: 'Claude Code', publishedBy: 'Art' },
    })
    const html = await (await worker.fetch(read(id), env)).text()

    expect(html).toContain('<dt>Explained by</dt><dd>Claude Code</dd>')
    expect(html).toContain('<dt>Published by</dt><dd>Art</dd>')
    expect(html).toContain('<dt>Published at</dt><dd>')
    expect(html).toContain('self-reported attribution, not verified identity')
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
    expect((await response.json()) as ExplainDocument).toMatchObject(document())
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

describe('updating a report', () => {
  test('replaces the content behind the same ID and keeps the link working', async () => {
    const { id, revocationToken } = await publish(document(['Original']))

    const response = await worker.fetch(
      updateRequest(id, revocationToken, document(['Revised', 'Another section'])),
      env,
    )

    expect(response.status).toBe(200)
    expect([...bucket.objects.keys()]).toEqual([`reports/${id}.json`])
    expect(JSON.parse(bucket.objects.get(`reports/${id}.json`)!.body)).toMatchObject(
      document(['Revised', 'Another section']),
    )

    const html = await (await worker.fetch(read(id), env)).text()
    expect(html).toContain('Revised')
    expect(html).not.toContain('Original')
  })

  test('re-stamps publishedAt on update and keeps the client attribution', async () => {
    const { id, revocationToken } = await publish(document(['Original']))

    const response = await worker.fetch(
      updateRequest(id, revocationToken, {
        ...document(['Revised']),
        metadata: {
          explainedBy: 'Claude Code',
          publishedBy: 'Art',
          publishedAt: '1999-01-01T00:00:00.000Z',
        },
      }),
      env,
    )

    expect(response.status).toBe(200)
    const stored = JSON.parse(bucket.objects.get(`reports/${id}.json`)!.body) as ExplainDocument
    expect(stored.metadata?.explainedBy).toBe('Claude Code')
    expect(stored.metadata?.publishedBy).toBe('Art')
    expect(stored.metadata?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(stored.metadata?.publishedAt).not.toBe('1999-01-01T00:00:00.000Z')

    const invalid = structuredClone({
      ...document(['Refused']),
      metadata: { explainedBy: 'Claude Code' },
    }) as Record<string, any>
    invalid.metadata.extra = 'nope'
    expect((await worker.fetch(updateRequest(id, revocationToken, invalid), env)).status).toBe(400)
  })

  test('the revocation token still removes the updated report', async () => {
    const { id, revocationToken } = await publish()
    await worker.fetch(updateRequest(id, revocationToken, document(['Revised'])), env)

    const wrong = await worker.fetch(updateRequest(id, 'not-the-token', document(['Again'])), env)
    expect(wrong.status).toBe(403)

    const revoked = await worker.fetch(revokeRequest(id, revocationToken), env)

    expect(revoked.status).toBe(204)
    expect(bucket.objects.size).toBe(0)
  })

  test('a missing, wrong, crossed, or unknown credential leaves the report unchanged', async () => {
    const { id, revocationToken } = await publish(document(['Original']))
    const before = bucket.objects.get(`reports/${id}.json`)!.body
    const other = await publish()

    const noToken = await worker.fetch(updateRequest(id, null, document(['Revised'])), env)
    expect(noToken.status).toBe(401)

    const wrong = await worker.fetch(updateRequest(id, 'wrong-token', document(['Revised'])), env)
    expect(wrong.status).toBe(403)

    const crossed = await worker.fetch(
      updateRequest(other.id, revocationToken, document(['Revised'])),
      env,
    )
    expect(crossed.status).toBe(403)

    const unknown = await worker.fetch(
      updateRequest('AAAAAAAAAAAAAAAAAAAAAA', revocationToken, document(['Revised'])),
      env,
    )
    expect(unknown.status).toBe(404)

    expect(bucket.objects.get(`reports/${id}.json`)!.body).toBe(before)
  })

  test('an invalid document is refused without replacing the stored report', async () => {
    const { id, revocationToken } = await publish(document(['Original']))
    const before = bucket.objects.get(`reports/${id}.json`)!.body

    const wrongShape = await worker.fetch(
      updateRequest(id, revocationToken, { formatVersion: 2 }),
      env,
    )
    expect(wrongShape.status).toBe(400)

    const invalidJson = await worker.fetch(updateRequest(id, revocationToken, '{not json'), env)
    expect(invalidJson.status).toBe(400)

    const wrongType = await worker.fetch(
      new Request(`https://reports.example/api/reports/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', authorization: `Bearer ${revocationToken}` },
        body: 'nope',
      }),
      env,
    )
    expect(wrongType.status).toBe(415)

    const oversized = document(['Original'])
    oversized.sections[0]!.steps[0]!.text = 'x'.repeat(1024 * 1024 + 1)
    const tooLarge = await worker.fetch(updateRequest(id, revocationToken, oversized), env)
    expect(tooLarge.status).toBe(413)

    expect(bucket.objects.get(`reports/${id}.json`)!.body).toBe(before)
  })

  test('the endpoint accepts GET, PUT, and DELETE', async () => {
    const { id } = await publish()
    const response = await worker.fetch(
      new Request(`https://reports.example/api/reports/${id}`, { method: 'PATCH' }),
      env,
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, PUT, DELETE')
  })
})

describe('everything else', () => {
  test('serves the shared report favicon', async () => {
    const response = await worker.fetch(new Request('https://reports.example/favicon.svg'), env)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(await response.text()).toContain('fill="#436354"')
  })

  test('unknown API paths answer as JSON and other paths fall through to static assets', async () => {
    const api = await worker.fetch(new Request('https://reports.example/api/nope'), env)
    expect(api.status).toBe(404)
    expect(api.headers.get('content-type')).toBe('application/json; charset=utf-8')

    const asset = await worker.fetch(new Request('https://reports.example/report.css'), env)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe('static asset')
  })
})
