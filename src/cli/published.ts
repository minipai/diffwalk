import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

// The review's revocation token is the only credential that can replace or remove the
// review. Retaining it next to the capture keeps `publish --update` and `unpublish` able
// to authenticate without asking the author to copy a secret between commands.
export const publishedReviewSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    service: z.string().min(1),
    revocationToken: z.string().min(1),
  })
  .strict()
export interface PublishedReview {
  id: string
  url: string
  service: string
  revocationToken: string
}

export async function readPublishedReview(path: string): Promise<PublishedReview | null> {
  let text: string
  try {
    text = await readFile(resolve(path), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return publishedReviewSchema.parse(JSON.parse(text))
  } catch (error) {
    throw new Error(`Could not read the retained review at ${path}: ${(error as Error).message}`)
  }
}

export async function writePublishedReview(path: string, review: PublishedReview): Promise<void> {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  // The token is a credential, so the file is owner-only rather than world-readable.
  await writeFile(absolutePath, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 })
}

// Revoking the review and deleting its credential are one step: a token that outlives the
// review makes the walk look published while `--update` can only ever fail.
export async function removePublishedReview(path: string): Promise<void> {
  await rm(resolve(path), { force: true })
}
