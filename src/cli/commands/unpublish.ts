import { z } from 'zod'
import { reportService, unpublishDocument } from '../../publish'
import { UsageError } from '../usage'

export const unpublishOptionsSchema = z.object({
  token: z.string().optional(),
  service: z.string().optional(),
})
type UnpublishOptions = z.infer<typeof unpublishOptionsSchema>

export async function unpublishCommand(id: string, options: UnpublishOptions): Promise<void> {
  const { token } = options
  if (token === undefined) {
    throw new UsageError('Pass the review\'s revocation token with --token')
  }
  const service = reportService(options.service)
  await unpublishDocument(id, service, token)
  console.log(`Removed review ${id} from ${service}`)
}
