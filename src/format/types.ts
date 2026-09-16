export type GitMode = '000000' | '100644' | '100755'

export interface BinarySide {
  size: number
  hash: string
}

// A rename whose destination or source is a literal exclusion keeps the detected move but
// omits the excluded side, so the status records the direction instead of degrading the
// change to a plain addition or deletion.
export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'moved-to-excluded'
  | 'moved-from-excluded'

export interface DraftFile {
  path: string
  oldPath?: string
  excludedPath?: string
  status: FileStatus
  oldMode: GitMode
  newMode: GitMode
  oldContent: string
  newContent: string
  oldBinary?: BinarySide
  newBinary?: BinarySide
}

export interface ChangeSide {
  kind: 'text' | 'binary'
  size: number
  hash: string
}

export interface TextChangeBlock {
  kind: 'text'
  id: string
  path: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  before: string
  after: string
}

export interface BinaryChangeBlock {
  kind: 'binary'
  id: string
  path: string
  status: FileStatus
  oldPath?: string
  excludedPath?: string
  oldMode: GitMode
  newMode: GitMode
  before?: ChangeSide
  after?: ChangeSide
}

export type ChangeBlock = TextChangeBlock | BinaryChangeBlock

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
  binary?: BinaryChangeBlock[]
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
