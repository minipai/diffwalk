import { z } from 'zod'

export const explanationSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().default(''),
    html: z.string().optional(),
  })
  .strict()

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

export const draftSourceSchema = z
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

export const explainDraftSchema = z
  .object({
    draftVersion: z.literal(1),
    source: draftSourceSchema,
    files: z.array(draftFileSchema),
    changes: z.array(changeBlockSchema),
    sections: z.array(
      z
        .object({
          explain: explanationSchema,
          changes: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict()

export const explainDocumentSchema = z
  .object({
    formatVersion: z.literal(1),
    source: documentSourceSchema,
    sections: z
      .array(
        z
          .object({
            explain: explanationSchema,
            diff: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type DraftFile = z.infer<typeof draftFileSchema>
export type ChangeBlock = z.infer<typeof changeBlockSchema>
export type ExplainDraft = z.infer<typeof explainDraftSchema>
export type ExplainDocument = z.infer<typeof explainDocumentSchema>
