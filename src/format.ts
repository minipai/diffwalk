import { z } from 'zod'

export const draftFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).optional(),
    status: z.enum(['added', 'modified', 'deleted', 'renamed']),
    oldContent: z.string(),
    newContent: z.string(),
  })
  .strict()

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

export const captureSourceSchema = z
  .object({
    kind: z.literal('working-tree'),
    capturedAt: z.string().datetime(),
    from: commitEndpointSchema,
  })
  .strict()

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
  .strict()

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

export const explanationsSchema = z
  .object({
    captureId: z.string().min(1),
    title: z.string().min(1),
    summary: z.preprocess((value) => value ?? '', z.string()).default(''),
    sections: z.array(explanationSectionSchema),
  })
  .strict()

export const documentStepSchema = z
  .object({
    text: z.string().default(''),
    diff: z.string().min(1).optional(),
  })
  .strict()
  .refine((step) => step.text.trim() !== '' || step.diff !== undefined, {
    message: 'a step needs text, a diff, or both',
  })

export const explainDocumentSchema = z
  .object({
    formatVersion: z.literal(1),
    title: z.string().min(1),
    summary: z.string().default(''),
    source: documentSourceSchema,
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
  .strict()

export type DraftFile = z.infer<typeof draftFileSchema>
export type ChangeBlock = z.infer<typeof changeBlockSchema>
export type CaptureSource = z.infer<typeof captureSourceSchema>
export type ExplainCapture = z.infer<typeof captureSchema>
export type ExplanationStep = z.infer<typeof explanationStepSchema>
export type Explanations = z.infer<typeof explanationsSchema>
export type DocumentStep = z.infer<typeof documentStepSchema>
export type ExplainDocument = z.infer<typeof explainDocumentSchema>
