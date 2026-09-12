import { z } from 'zod'
import { unpublishDocument } from '../../publish/client'
import { reportService } from '../service'
import { UsageError } from '../usage'

const unpublishOptionsSchema = z.object({
  token: z.string().optional(),
  service: z.string().optional(),
})

export async function removeReview(reportId: string, options: z.input<typeof unpublishOptionsSchema>): Promise<void> {
  const { token, service: serviceOption } = unpublishOptionsSchema.parse(options)
  validateRevocationToken(token)
  const service = reportService(serviceOption)
  await unpublishDocument(reportId, service, token)
  console.log(`Removed review ${reportId} from ${service}`)
}

function validateRevocationToken(token: string | undefined): asserts token is string {
  if (token === undefined) {
    throw new UsageError('Pass the review\'s revocation token with --token')
  }
}
