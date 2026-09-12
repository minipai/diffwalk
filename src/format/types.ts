export interface DraftFile {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldMode: '000000' | '100644' | '100755'
  newMode: '000000' | '100644' | '100755'
  oldContent: string
  newContent: string
}

export interface ChangeBlock {
  id: string
  path: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  before: string
  after: string
}

interface CommitEndpoint {
  revision: string
  commit: string
}

export type CaptureSource =
  | { kind: 'working-tree'; capturedAt: string; from: CommitEndpoint }
  | { kind: 'commit-diff'; capturedAt: string; from: CommitEndpoint; to: CommitEndpoint }

export interface ExplainCapture {
  captureId: string
  source: CaptureSource
  files: DraftFile[]
  changes: ChangeBlock[]
}

export interface ExplanationStep {
  text: string
  changes?: string[]
}

export interface Explanations {
  captureId: string
  title: string
  summary: string
  metadata?: { explainedBy?: string }
  sections: { title: string; steps: ExplanationStep[] }[]
}

export interface DocumentStep {
  text: string
  diff?: string
  changes?: string[]
}

export interface ExplainDocument {
  formatVersion: 1
  title: string
  summary: string
  source: CaptureSource | { kind: 'proposal'; capturedAt: string }
  metadata?: { explainedBy?: string; publishedBy?: string; publishedAt?: string }
  sections: { title: string; steps: DocumentStep[] }[]
}
