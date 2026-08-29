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

interface ReportBody {
  title: string
  markup: string
  data: ReportData
}

function renderReportBody(
  document: ExplainDocument,
  options: ReportOptions = {},
): ReportBody {
  const title = options.title ?? 'Diffwalk change report'
  const layout = options.layout ?? 'split'
  const sections = document.sections.map(renderSection)
  const files = sections.reduce((total, section) => total + section.fileCount, 0)
  const reviewMap = renderReviewMap(
    document.sections.map((section) => section.explain.title),
    { sections: sections.length, files },
  )
  const markup = `<header class="report-header">
  <h1>${escapeHtml(title)}</h1>
  <dl class="source-metadata">
    ${renderSourceMetadata(document.source)}
  </dl>
  <form class="layout-form" data-layout-form aria-label="Diff layout">
    <label><input type="radio" name="layout" value="split" ${layout === 'split' ? 'checked' : ''}> Split</label>
    <label><input type="radio" name="layout" value="unified" ${layout === 'unified' ? 'checked' : ''}> Unified</label>
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</header>
<div class="review-workspace">
${reviewMap}
<main>
${sections.map((section) => section.markup).join('\n')}
</main>
</div>`
  return {
    title,
    markup,
    data: {
      source: document.source,
      sections: sections.map((section) => ({ diff: section.diff, fileCount: section.fileCount })),
    },
  }
}

export function renderReport(
  document: ExplainDocument,
  clientBundle: string,
  options: ReportOptions = {},
): string {
  const body = renderReportBody(document, options)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(body.title)}</title>
<style>
${shellStyles}
</style>
</head>
<body>
${body.markup}
<script type="application/json" id="diffwalk-report-data">${embedData(body.data)}</script>
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
  const markup = `<section class="section" id="section-${index}" data-section-index="${index}">
  <details class="section-fold" open>
    <summary class="section-title">${escapeHtml(section.explain.title)}</summary>
    <div class="section-body">${bodyMarkup}</div>
    ${fragment}
    <div class="section-files">${filesMarkup}</div>
  </details>
</section>`
  return { markup, diff: section.diff, fileCount: files.length }
}

function renderReviewMap(
  titles: string[],
  counts: { sections: number; files: number },
): string {
  const links = titles
    .map(
      (title, index) =>
        `<li><a href="#section-${index}"><span class="review-map-index">${String(index + 1).padStart(2, '0')}</span><span class="review-map-title">${escapeHtml(title)}</span></a></li>`,
    )
    .join('\n')
  return `<nav class="review-map" aria-label="Review map">
  <p class="review-map-label">Review map</p>
  <ol class="review-map-list">
${links}
  </ol>
  <p class="review-map-counts">
    <span>${pluralize(counts.sections, 'section')}</span>
    <span>${pluralize(counts.files, 'file')}</span>
  </p>
</nav>`
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
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

export const shellStyles = `
:root {
  color-scheme: light;
  --background: #f8faf7;
  --panel: #ffffff;
  --border: #d7e0d8;
  --text: #17221a;
  --muted: #657169;
  --accent: #176b45;
  --file-background: #f4f7f4;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  color: var(--text);
  background:
    linear-gradient(90deg, rgba(23, 107, 69, .035) 1px, transparent 1px),
    linear-gradient(rgba(23, 107, 69, .035) 1px, transparent 1px),
    var(--background);
  background-size: 32px 32px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
.report-header {
  position: sticky;
  z-index: 10;
  top: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, auto) auto;
  align-items: center;
  gap: 22px;
  min-height: 72px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, .92);
  backdrop-filter: blur(16px);
  box-shadow: 0 1px 18px rgba(29, 58, 38, .05);
}
.report-header h1 { margin: 0; color: #122419; font-size: 17px; letter-spacing: -.01em; }
.source-metadata {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0 8px;
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}
.source-metadata dt { color: #7e8d82; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
.source-metadata dd { margin: 0; min-width: 0; overflow: hidden; color: #4e5d53; text-overflow: ellipsis; white-space: nowrap; }
.source-metadata code { color: #263a2d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.layout-form {
  justify-self: end;
  display: inline-flex;
  border: 1px solid #bdcbbf;
  border-radius: 7px;
  overflow: hidden;
  background: #f3f7f3;
}
.layout-form label { padding: 5px 10px; color: #607066; font-size: 13px; cursor: pointer; }
.layout-form input { display: none; }
.layout-form label:has(input:checked) { color: #ffffff; background: var(--accent); font-weight: 600; }
.review-workspace {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  min-height: calc(100vh - 72px);
}
.review-map {
  position: sticky;
  top: 72px;
  align-self: start;
  height: calc(100vh - 72px);
  padding: 24px 14px;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: #f0f5f0;
}
.review-map-label {
  margin: 0 10px 12px;
  color: #718277;
  font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.review-map-list { margin: 0; padding: 0; list-style: none; }
.review-map-list a {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  padding: 9px 10px;
  border-radius: 7px;
  color: #45574b;
  font-size: 13px;
  line-height: 1.35;
  text-decoration: none;
}
.review-map-list a:hover { color: #0f5636; background: #e2eee4; }
.review-map-index { color: var(--accent); font: 600 11px/1.6 ui-monospace, monospace; }
.review-map-title { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.review-map-counts { display: flex; gap: 8px; margin: 22px 10px 0; }
.review-map-counts span {
  padding: 5px 7px;
  border: 1px solid #cbd7cd;
  border-radius: 5px;
  color: #66776c;
  background: rgba(255, 255, 255, .65);
  font: 11px/1 ui-monospace, monospace;
}
main { max-width: none; min-width: 0; margin: 0; padding: 22px 28px 72px; }
.section { max-width: 1480px; margin: 0 auto 22px; scroll-margin-top: 94px; }
.section-fold {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 14px 38px rgba(37, 72, 48, .07);
}
.section-fold > summary {
  cursor: pointer;
  overflow-wrap: anywhere;
  padding: 12px 16px;
  border-bottom: 1px solid transparent;
  color: #17271c;
  background: transparent;
  font-size: 15px;
  font-weight: 600;
  list-style: none;
  user-select: none;
}
.section-fold > summary::-webkit-details-marker { display: none; }
.section-fold > summary::before { content: "▾ "; color: var(--accent); }
.section-fold:not([open]) > summary::before { content: "▸ "; }
.section-fold[open] > summary { border-bottom-color: var(--border); }
.section-body { max-width: 900px; padding: 18px 20px 8px; color: #3c4d41; font-size: 14px; }
.section-body strong { color: #142c1d; }
.section-body-empty { color: var(--muted); font-style: italic; }
.section-fragment { max-width: 1000px; padding: 4px 20px 14px; }
.section-fragment > :first-child { margin-top: 0; }
.section-files { padding: 12px; display: grid; gap: 9px; }
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
  overflow: hidden;
  border: 1px solid #d2ddd4;
  border-radius: 7px;
  background: #f8faf8;
}
.file > summary {
  cursor: pointer;
  padding: 8px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: #314439;
  background: #f3f7f3;
  list-style: none;
  user-select: none;
}
.file > summary::-webkit-details-marker { display: none; }
.file > summary::before { content: "▸ "; }
.file[open] > summary::before { content: "▾ "; }
.file-stats { float: right; color: #6d7d72; }
.file-diff { border-top: 1px solid #d2ddd4; }
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
@media (max-width: 900px) {
  .report-header { position: relative; grid-template-columns: 1fr auto; background: rgba(255, 255, 255, .96); }
  .source-metadata { display: none; }
  .review-workspace { display: block; }
  .review-map { display: none; }
  main { padding: 14px 10px 50px; }
}
@media (max-width: 520px) {
  .report-header { padding: 10px 12px; }
  .report-header h1 { font-size: 14px; }
  .layout-form label { padding: 4px 7px; font-size: 11px; }
  .section-fold > summary { font-size: 14px; }
}
@media print {
  .layout-form { display: none; }
  .review-map { display: none; }
  .review-workspace { display: block; }
  .report-header { position: static; grid-template-columns: 1fr; gap: 4px 22px; background: #ffffff; box-shadow: none; backdrop-filter: none; }
  .source-metadata { display: grid; }
  .source-metadata dd { white-space: normal; overflow: visible; }
  main { padding: 16px; }
  body { background: #ffffff; }
  .section, .file { break-inside: avoid; }
  .file-diff { print-color-adjust: exact; }
  details { border: 1px solid var(--border) !important; }
}
`
