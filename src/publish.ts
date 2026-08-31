import type { ExplainDocument } from './format'

export interface PublishedReport {
  id: string
  url: string
  revocationToken: string
}

const defaultService = 'https://review.diffwalk.dev'

export function reportService(explicit: string | undefined): string {
  const value = explicit ?? process.env['DIFFWALK_SERVICE_URL'] ?? defaultService
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Not a valid report service URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`The report service must be reached over HTTPS: ${value}`)
  }
  return url.origin
}

export async function publishDocument(
  document: ExplainDocument,
  service: string,
): Promise<PublishedReport> {
  const response = await fetch(`${service}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  })
  if (!response.ok) {
    throw new Error(`Could not publish the report: ${await failureDetail(response)}`)
  }

  const value = (await response.json()) as { id?: unknown; revocationToken?: unknown }
  if (typeof value.id !== 'string' || typeof value.revocationToken !== 'string') {
    throw new Error('The report service returned a response this version does not understand')
  }
  return {
    id: value.id,
    url: `${service}/r/${value.id}`,
    revocationToken: value.revocationToken,
  }
}

export async function unpublishDocument(
  id: string,
  service: string,
  revocationToken: string,
): Promise<void> {
  const response = await fetch(`${service}/api/reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${revocationToken}` },
  })
  if (!response.ok) {
    throw new Error(`Could not remove the report: ${await failureDetail(response)}`)
  }
}

async function failureDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const value = JSON.parse(text) as { error?: unknown }
    if (typeof value.error === 'string') return `${response.status} ${value.error}`
  } catch {
    // The service answered with something other than a problem document.
  }
  return `${response.status} ${response.statusText}`.trim()
}
