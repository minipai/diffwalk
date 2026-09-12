import type { ExplainDocument } from '../format/types'

export interface PublishedReport {
  id: string
  url: string
  revocationToken: string
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
  await validateServiceResponse(response, 'publish')

  const value = (await response.json()) as { id?: unknown; revocationToken?: unknown }
  validatePublishedReport(value)
  return {
    id: value.id,
    url: `${service}/r/${value.id}`,
    revocationToken: value.revocationToken,
  }
}

export async function updateDocument(
  document: ExplainDocument,
  reportId: string,
  service: string,
  revocationToken: string,
): Promise<void> {
  const response = await fetch(`${service}/api/reports/${encodeURIComponent(reportId)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${revocationToken}`,
    },
    body: JSON.stringify(document),
  })
  await validateServiceResponse(response, 'update')
}

export async function unpublishDocument(
  reportId: string,
  service: string,
  revocationToken: string,
): Promise<void> {
  const response = await fetch(`${service}/api/reports/${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${revocationToken}` },
  })
  await validateServiceResponse(response, 'remove')
}

// The publisher is self-reported attribution, not a credential. It is read at publish time
// so the authoring files never carry it, and omitted cleanly when Git has no user name.
export function withPublisher(
  document: ExplainDocument,
  publishedBy: string | undefined,
): ExplainDocument {
  if (publishedBy === undefined) return document
  return { ...document, metadata: { ...document.metadata, publishedBy } }
}

async function validateServiceResponse(response: Response, action: 'publish' | 'update' | 'remove'): Promise<void> {
  if (!response.ok) {
    throw new Error(`Could not ${action} the review: ${await failureDetail(response)}`)
  }
}

function validatePublishedReport(
  value: { id?: unknown; revocationToken?: unknown },
): asserts value is { id: string; revocationToken: string } {
  if (typeof value.id !== 'string' || typeof value.revocationToken !== 'string') {
    throw new Error('The review service returned a response this version does not understand')
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
