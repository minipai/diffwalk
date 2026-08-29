import { createHunkDiffFilesFromPatch, type HunkDiffFile } from 'hunkdiff/opentui'
import { explainDocumentSchema, type ExplainDocument } from './format'

export interface ExplainSection {
  id: string
  title: string
  body: string
  html?: string
  files: HunkDiffFile[]
}

export function parseExplainSectionsJson(json: string): ExplainSection[] {
  const value: unknown = JSON.parse(json)
  return explainSectionsFromDocument(explainDocumentSchema.parse(value))
}

export function explainSectionsFromDocument(document: ExplainDocument): ExplainSection[] {
  return document.sections.map((section, index) => {
    const id = `explanation:${index}`
    const files = createHunkDiffFilesFromPatch(section.diff, id)
    if (files.length === 0) {
      throw new Error(`Explanation "${section.explain.title}" contains no parseable diff files`)
    }
    return {
      id,
      title: section.explain.title,
      body: section.explain.body,
      html: section.explain.html,
      files,
    }
  })
}
