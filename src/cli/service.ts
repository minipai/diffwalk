import { configuredService } from './config'

const defaultService = 'https://review.diffwalk.dev'

// New publications and revocations resolve the service in order: the explicit flag, the
// project config, then the hosted default. The environment is deliberately not consulted,
// so a stray DIFFWALK_SERVICE_URL cannot redirect a review or its token. `publish --update`
// passes the retained service as `explicit`, so a changed config can never redirect an
// existing review or send its token elsewhere.
export function reportService(explicit: string | undefined, directory = process.cwd()): string {
  const value = explicit ?? configuredService(directory) ?? defaultService
  const url = parseServiceUrl(value)
  validateServiceProtocol(url, value)
  return url.origin
}

function parseServiceUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error(`Not a valid review service URL: ${value}`)
  }
}

function validateServiceProtocol(url: URL, value: string): void {
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`The review service must be reached over HTTPS: ${value}`)
  }
}
