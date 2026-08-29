import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import type { ExplainDocument } from './format'
import { renderMarkdown } from './report-markdown'
import { fileDiffLabel, fileDiffStats, parseSectionPatch } from './report-patches'
import type { FileDiffMetadata } from '@pierre/diffs'

export type ReportLayout = 'split' | 'unified'

export interface ReportOptions {
  title?: string
  layout?: ReportLayout
}

interface ReportSectionData {
  diff: string
  fileCount: number
}

interface ReportData {
  source: unknown
  sections: ReportSectionData[]
}

export function renderReport(
  document: ExplainDocument,
  clientBundle: string,
  options: ReportOptions = {},
): string {
  const title = options.title ?? 'Diffwalk change report'
  const layout = options.layout ?? 'split'
  const sections = document.sections.map(renderSection)
  const data = embedData({
    source: document.source,
    sections: sections.map((section) => ({ diff: section.diff, fileCount: section.fileCount })),
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${shellStyles}
</style>
</head>
<body>
<header class="report-header">
  <h1>${escapeHtml(title)}</h1>
  <dl class="source-metadata">
    ${renderSourceMetadata(document.source)}
  </dl>
  <form class="layout-form" data-layout-form aria-label="Diff layout">
    <label><input type="radio" name="layout" value="split" ${layout === 'split' ? 'checked' : ''}> Split</label>
    <label><input type="radio" name="layout" value="unified" ${layout === 'unified' ? 'checked' : ''}> Unified</label>
    <button type="submit">Apply</button>
  </form>
</header>
<main>
${sections.map((section) => section.markup).join('\n')}
</main>
<script type="application/json" id="diffwalk-report-data">${data}</script>
<script>${escapeScriptTerminators(clientBundle)}</script>
</body>
</html>
`
}

function renderSection(section: ExplainDocument['sections'][number], index: number): {
  markup: string
  diff: string
  fileCount: number
} {
  let files: FileDiffMetadata[]
  try {
    files = parseSectionPatch(section.diff)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Section "${section.explain.title}" has an unparseable diff: ${detail}`)
  }
  const filesMarkup = files
    .map((file, fileIndex) => {
      const stats = fileDiffStats(file)
      return `<details class="file" open>
  <summary class="file-summary">${escapeHtml(fileDiffLabel(file))} <span class="file-stats">+${stats.additions} −${stats.deletions}</span></summary>
  <div class="file-diff" id="section-${index}-file-${fileIndex}"></div>
</details>`
    })
    .join('\n')
  const body = section.explain.body.trim()
  const bodyMarkup =
    body === ''
      ? `<p class="section-body-empty">No explanation body.</p>`
      : renderMarkdown(body)
  const fragment = section.explain.html ? `<div class="section-fragment">${section.explain.html}</div>` : ''
  const markup = `<section class="section" data-section-index="${index}">
  <details class="section-fold" open>
    <summary class="section-title">${escapeHtml(section.explain.title)}</summary>
    <div class="section-body">${bodyMarkup}</div>
    ${fragment}
    <div class="section-files">${filesMarkup}</div>
  </details>
</section>`
  return { markup, diff: section.diff, fileCount: files.length }
}

function renderSourceMetadata(source: ExplainDocument['source']): string {
  if (source.kind === 'commit-diff') {
    return `<dt>From</dt><dd>${renderEndpoint(source.from)}</dd>
    <dt>To</dt><dd>${renderEndpoint(source.to)}</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
  }
  if (source.kind === 'working-tree') {
    return `<dt>From</dt><dd>${renderEndpoint(source.from)}</dd>
    <dt>To</dt><dd>Working tree</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
  }
  return `<dt>Source</dt><dd>Proposal</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
}

function renderEndpoint(endpoint: { revision: string; commit: string }): string {
  return `${escapeHtml(endpoint.revision)} <code>${escapeHtml(endpoint.commit)}</code>`
}

function embedData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function escapeScriptTerminators(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\x2d\\x2d')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => entities[char]!)
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export async function writeReport(output: string, html: string): Promise<void> {
  const absolutePath = resolve(output)
  await mkdir(dirname(absolutePath), { recursive: true })
  const tempPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(tempPath, html)
    await rename(tempPath, absolutePath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

let reportClientPromise: Promise<string> | null = null

export function loadReportClient(): Promise<string> {
  reportClientPromise ??= loadReportClientUncached()
  return reportClientPromise
}

async function loadReportClientUncached(): Promise<string> {
  const root = resolve(import.meta.dir, '..')
  const prebuilt = join(root, 'dist', 'report-client.js')
  if (existsSync(prebuilt)) return readFile(prebuilt, 'utf8')
  const entry = join(root, 'src', 'report-client.ts')
  if (!existsSync(entry)) {
    throw new Error(
      'The report client bundle is missing. Rebuild the CLI with `pnpm build` and try again.',
    )
  }
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: true,
  })
  const output = result.outputs[0]
  if (!output) throw new Error('Report client bundle produced no output')
  return output.text()
}

const shellStyles = `
:root {
  color-scheme: light;
  --background: #f7f8fa;
  --panel: #ffffff;
  --border: #d0d7de;
  --text: #1f2328;
  --muted: #57606a;
  --accent: #0969da;
  --file-background: #f6f8fa;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--background);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
.report-header {
  padding: 24px max(16px, calc((100% - 880px) / 2));
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.report-header h1 { margin: 0 0 8px; font-size: 24px; }
.source-metadata {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 12px;
  margin: 0 0 12px;
  font-size: 14px;
}
.source-metadata dt { color: var(--muted); font-weight: 600; }
.source-metadata dd { margin: 0; min-width: 0; }
.source-metadata code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
.layout-form {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--file-background);
}
.layout-form label {
  padding: 4px 12px;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.layout-form input { accent-color: var(--accent); }
.layout-form label:has(input:checked) { background: var(--panel); color: var(--text); font-weight: 600; }
.layout-form button {
  padding: 4px 12px;
  font-size: 13px;
  border: 0;
  border-left: 1px solid var(--border);
  background: var(--accent);
  color: #ffffff;
  cursor: pointer;
}
main { max-width: 920px; margin: 0 auto; padding: 16px; }
.section { margin: 16px 0; }
.section-fold {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0;
}
.section-fold > summary {
  cursor: pointer;
  padding: 12px 16px;
  font-size: 18px;
  font-weight: 600;
  list-style: none;
  user-select: none;
}
.section-fold > summary::-webkit-details-marker { display: none; }
.section-fold > summary::before { content: "▾ "; color: var(--accent); }
.section-fold:not([open]) > summary::before { content: "▸ "; }
.section-body { padding: 0 16px 8px; }
.section-fragment { padding: 0 16px 8px; }
.section-fragment > :first-child { margin-top: 0; }
.section-body-empty { color: var(--muted); font-style: italic; }
.section-files { padding: 8px 16px 16px; display: grid; gap: 8px; }
.section-body h1, .section-body h2, .section-body h3, .section-body h4 {
  margin: 16px 0 8px;
  line-height: 1.25;
}
.section-body p { margin: 0 0 8px; }
.section-body ul, .section-body ol { margin: 0 0 8px; padding-left: 24px; }
.section-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--file-background);
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
.section-body pre {
  background: var(--file-background);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  overflow: auto;
}
.section-body pre code { background: none; padding: 0; }
.section-body blockquote {
  margin: 0 0 8px;
  padding: 0 12px;
  border-left: 4px solid var(--border);
  color: var(--muted);
}
.file {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--file-background);
}
.file > summary {
  cursor: pointer;
  padding: 6px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  list-style: none;
  user-select: none;
}
.file > summary::-webkit-details-marker { display: none; }
.file > summary::before { content: "▸ "; }
.file[open] > summary::before { content: "▾ "; }
.file-stats { color: var(--muted); }
.file-diff { border-top: 1px solid var(--border); }
.file-diff:empty { border-top: none; }
.diff-error {
  margin: 8px;
  padding: 10px 12px;
  border: 1px solid #cf222e;
  border-radius: 6px;
  background: #fff5f5;
  color: #cf222e;
  font-size: 13px;
}
@media (max-width: 720px) {
  main { padding: 8px; }
  .section-fold > summary { font-size: 16px; }
  .report-header { padding: 16px; }
}
@media print {
  .layout-form { display: none; }
  body { background: #ffffff; }
  .report-header { padding: 16px; }
  .section, .file { break-inside: avoid; }
  .file-diff { print-color-adjust: exact; }
  details { border: 1px solid var(--border) !important; }
}
`