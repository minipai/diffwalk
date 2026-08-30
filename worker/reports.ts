export const maxDocumentBytes = 1024 * 1024

const idPattern = /^[A-Za-z0-9_-]{22}$/

export function isReportId(value: string): boolean {
  return idPattern.test(value)
}

export function reportKey(id: string): string {
  return `reports/${id}.json`
}

export function createReportId(): string {
  return randomToken(16)
}

export function createRevocationToken(): string {
  return randomToken(32)
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64url(new Uint8Array(digest))
}

export function secretsMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token === '' ? null : token
}

function randomToken(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return base64url(buffer)
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
