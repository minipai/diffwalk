import { parseDocument } from 'yaml'
import { ZodError } from 'zod'
import { explanationsSchema } from '../format/schema'
import type { Explanations } from '../format/types'

export function parseExplanations(text: string): Explanations {
  const document = parseDocument(text, { strict: true, schema: 'core' })
  validateExplanationsYaml(document)
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  try {
    return explanationsSchema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid explanations YAML: ${detail}`)
    }
    throw error
  }
}

function validateExplanationsYaml(document: ReturnType<typeof parseDocument>): void {
  const problems = [...document.errors, ...document.warnings]
  if (problems.length > 0) {
    throw new Error(`Invalid explanations YAML: ${problems[0]!.message}`)
  }
  if (document.contents === null) {
    throw new Error('Invalid explanations YAML: the document is empty')
  }
}
