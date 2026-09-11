import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPublishedReview, writePublishedReview } from '../src/authoring/published'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function temporaryPath(name = 'published.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'diffwalk-published-'))
  directories.push(directory)
  return join(directory, name)
}

const review = {
  id: 'Zm9vYmFyYmF6cXV4MTIz',
  url: 'https://review.diffwalk.dev/r/Zm9vYmFyYmF6cXV4MTIz',
  service: 'https://review.diffwalk.dev',
  revocationToken: 'a-retained-revocation-token',
}

describe('published review retention', () => {
  test('round-trips the review and its revocation capability', async () => {
    const path = await temporaryPath()

    await writePublishedReview(path, review)

    expect(await readPublishedReview(path)).toEqual(review)
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(raw['revocationToken']).toBe(review.revocationToken)
  })

  test('keeps the stored credential owner-only', async () => {
    if (process.platform === 'win32') return
    const path = await temporaryPath()

    await writePublishedReview(path, review)

    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test('an absent record means the walk was never published', async () => {
    expect(await readPublishedReview(await temporaryPath())).toBeNull()
  })

  test('a malformed or incomplete record is refused with its path', async () => {
    const malformed = await temporaryPath('malformed.json')
    await writeFile(malformed, '{not json')
    await expect(readPublishedReview(malformed)).rejects.toThrow(malformed)

    const incomplete = await temporaryPath('incomplete.json')
    await writeFile(incomplete, JSON.stringify({ id: 'only-an-id' }))
    await expect(readPublishedReview(incomplete)).rejects.toThrow(incomplete)
  })
})
