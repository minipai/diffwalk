import { z } from 'zod'
import type { ExplainCapture, ExplainDocument, Explanations } from './types'

const gitModeSchema = z.enum(['000000', '100644', '100755'])

export const draftFileSchema = z.preprocess(
  normalizeFileModes,
  z.object({
    path: z.string().min(1),
    oldPath: z.string().min(1).optional(),
    status: z.enum(['added', 'modified', 'deleted', 'renamed']),
    oldMode: gitModeSchema,
    newMode: gitModeSchema,
    oldContent: z.string(),
    newContent: z.string(),
  }).strict(),
)

export const changeBlockSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    oldStart: z.number().int().positive(),
    oldCount: z.number().int().nonnegative(),
    newStart: z.number().int().positive(),
    newCount: z.number().int().nonnegative(),
    before: z.string(),
    after: z.string(),
  })
  .strict()

export const commitEndpointSchema = z
  .object({
    revision: z.string().min(1),
    commit: z.string().min(1),
  })
  .strict()

export const captureSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('working-tree'),
      capturedAt: z.string().datetime(),
      from: commitEndpointSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('commit-diff'),
      capturedAt: z.string().datetime(),
      from: commitEndpointSchema,
      to: commitEndpointSchema,
    })
    .strict(),
])

export const documentSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('commit-diff'),
      capturedAt: z.string().datetime(),
      from: commitEndpointSchema,
      to: commitEndpointSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('working-tree'),
      capturedAt: z.string().datetime(),
      from: commitEndpointSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('proposal'),
      capturedAt: z.string().datetime(),
    })
    .strict(),
])

export const captureSchema = z
  .object({
    captureId: z.string().min(1),
    source: captureSourceSchema,
    files: z.array(draftFileSchema),
    changes: z.array(changeBlockSchema),
  })
  .strict() satisfies z.ZodType<ExplainCapture>

export const explanationStepSchema = z
  .object({
    text: z.preprocess((value) => value ?? '', z.string()).default(''),
    changes: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((step) => step.text.trim() !== '' || step.changes !== undefined, {
    message: 'a step needs text, changes, or both',
  })

export const explanationSectionSchema = z
  .object({
    title: z.string().min(1),
    steps: z.array(explanationStepSchema).min(1),
  })
  .strict()

export const explanationMetadataSchema = z
  .object({
    explainedBy: z.string().min(1).optional(),
  })
  .strict()

export const explanationsSchema = z
  .object({
    captureId: z.string().min(1),
    title: z.string().min(1),
    summary: z.preprocess((value) => value ?? '', z.string()).default(''),
    metadata: explanationMetadataSchema.optional(),
    sections: z.array(explanationSectionSchema),
  })
  .strict() satisfies z.ZodType<Explanations>

export const documentStepSchema = z
  .object({
    text: z.string().default(''),
    diff: z.string().min(1).optional(),
    changes: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((step) => step.text.trim() !== '' || step.diff !== undefined, {
    message: 'a step needs text, a diff, or both',
  })
  .refine((step) => step.changes === undefined || step.diff !== undefined, {
    message: 'captured change IDs require a diff',
  })

export const documentMetadataSchema = z
  .object({
    explainedBy: z.string().min(1).optional(),
    publishedBy: z.string().min(1).optional(),
    publishedAt: z.string().datetime().optional(),
  })
  .strict()

export const explainDocumentSchema = z
  .object({
    formatVersion: z.literal(1),
    title: z.string().min(1),
    summary: z.string().default(''),
    source: documentSourceSchema,
    metadata: documentMetadataSchema.optional(),
    sections: z
      .array(
        z
          .object({
            title: z.string().min(1),
            steps: z.array(documentStepSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict() satisfies z.ZodType<ExplainDocument>

function normalizeFileModes(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const file = value as Record<string, unknown>
  return {
    ...file,
    oldMode: file.oldMode ?? (file.status === 'added' ? '000000' : '100644'),
    newMode: file.newMode ?? (file.status === 'deleted' ? '000000' : '100644'),
  }
}
