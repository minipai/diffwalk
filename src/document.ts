import { createHunkDiffFilesFromPatch, type HunkDiffFile } from 'hunkdiff/opentui'
import { explainDocumentSchema, type ExplainDocument } from './format'

export interface ExplainStep {
  id: string
  text: string
  files: HunkDiffFile[]
}

export interface ExplainSection {
  id: string
  title: string
  steps: ExplainStep[]
}

export function parseExplainSectionsJson(json: string): ExplainSection[] {
  const value: unknown = JSON.parse(json)
  return explainSectionsFromDocument(explainDocumentSchema.parse(value))
}

export function explainSectionsFromDocument(document: ExplainDocument): ExplainSection[] {
  return document.sections.map((section, sectionIndex) => {
    const id = `explanation:${sectionIndex}`
    return {
      id,
      title: section.title,
      steps: section.steps.map((step, stepIndex) => {
        const stepId = `${id}/step:${stepIndex}`
        if (step.diff === undefined) return { id: stepId, text: step.text, files: [] }
        const files = createHunkDiffFilesFromPatch(step.diff, stepId)
        if (files.length === 0) {
          throw new Error(`Explanation "${section.title}" contains no parseable diff files`)
        }
        return { id: stepId, text: step.text, files }
      }),
    }
  })
}
