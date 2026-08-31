import { afterEach, describe, expect, test } from 'bun:test'
import { startReportPreview, type ReportPreview } from '../src/view'

const previews: ReportPreview[] = []

afterEach(async () => {
  await Promise.all(previews.splice(0).map((preview) => preview.close()))
})

describe('local report preview', () => {
  test('serves one report on a loopback-only ephemeral URL', async () => {
    const preview = await startReportPreview('<!doctype html><title>Local report</title>')
    previews.push(preview)

    expect(new URL(preview.url).hostname).toBe('127.0.0.1')
    const response = await fetch(preview.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('<title>Local report</title>')
  })

  test('does not serve the report from unrelated paths or methods', async () => {
    const preview = await startReportPreview('<p>private report</p>')
    previews.push(preview)

    const missing = await fetch(`${preview.url}/other`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).not.toContain('private report')

    const post = await fetch(preview.url, { method: 'POST' })
    expect(post.status).toBe(405)
  })
})
