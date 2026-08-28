import { createHunkDiffFilesFromPatch, type HunkDiffFile } from 'hunkdiff/opentui'
import { explainDocumentSchema } from './format'

export interface ExplainSection {
  id: string
  title: string
  body: string
  files: HunkDiffFile[]
}

export function parseExplainSectionsJson(json: string): ExplainSection[] {
  const value: unknown = JSON.parse(json)
  const document = explainDocumentSchema.parse(value)
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
      files,
    }
  })
}
