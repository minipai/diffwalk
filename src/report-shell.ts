import type { ExplainDocument } from './format'
import { renderMarkdown } from './report-markdown'
import { fileDiffLabel, fileDiffStats, parseSectionPatch } from './report-patches'
import type { FileDiffMetadata } from '@pierre/diffs'

export type ReportLayout = 'split' | 'unified'

export interface ReportOptions {
  title?: string
  layout?: ReportLayout
}

export interface HostedAssets {
  stylesHref: string
  clientSrc: string
}

interface ReportDiffMount {
  section: number
  step: number
  diff: string
}

interface ReportData {
  source: unknown
  diffs: ReportDiffMount[]
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
  const title = options.title ?? document.title
  const layout = options.layout ?? 'split'
  const sections = document.sections.map(renderSection)
  const files = sections.reduce((total, section) => total + section.fileCount, 0)
  const layoutForm = `<form class="layout-form" data-layout-form aria-label="Diff layout">
    <label><input type="radio" name="layout" value="split" ${layout === 'split' ? 'checked' : ''}> Split</label>
    <label><input type="radio" name="layout" value="unified" ${layout === 'unified' ? 'checked' : ''}> Unified</label>
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>`
  const reviewMap = renderReviewMap(
    document.sections.map((section) => section.title),
    { sections: sections.length, files },
    layoutForm,
  )
  const summary =
    document.summary.trim() === ''
      ? ''
      : `\n  <div class="cover-summary prose">${renderMarkdown(document.summary)}</div>`
  // Title, provenance, and summary are one opening, so they share one card. The layout
  // toggle lives in the sticky map instead: it is a reading control, wanted while
  // scrolled into a diff, and the card scrolls away.
  const markup = `<div class="review-workspace">
${reviewMap}
<main>
<section class="report-cover">
  <h1>${escapeHtml(title)}</h1>
  <dl class="source-metadata">
    ${renderSourceMetadata(document.source)}
  </dl>${summary}
</section>
${sections.map((section) => section.markup).join('\n')}
</main>
</div>`
  return {
    title,
    markup,
    data: {
      source: document.source,
      diffs: sections.flatMap((section) => section.diffs),
    },
  }
}

export function renderReport(
  document: ExplainDocument,
  clientBundle: string,
  options: ReportOptions = {},
): string {
  return renderShell(
    renderReportBody(document, options),
    `<style>\n${shellStyles}\n</style>`,
    `<script>${escapeScriptTerminators(clientBundle)}</script>`,
  )
}

export function renderHostedReport(
  document: ExplainDocument,
  assets: HostedAssets,
  options: ReportOptions = {},
): string {
  return renderShell(
    renderReportBody(document, options),
    `<link rel="stylesheet" href="${escapeHtml(assets.stylesHref)}">`,
    `<script src="${escapeHtml(assets.clientSrc)}" defer></script>`,
  )
}

function renderShell(body: ReportBody, styles: string, client: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(body.title)}</title>
${styles}
</head>
<body>
${body.markup}
<script type="application/json" id="diffwalk-report-data">${embedData(body.data)}</script>
${client}
</body>
</html>
`
}

function renderSection(section: ExplainDocument['sections'][number], index: number): {
  markup: string
  fileCount: number
  diffs: ReportDiffMount[]
} {
  const diffs: ReportDiffMount[] = []
  let fileCount = 0

  const steps = section.steps.map((step, stepIndex) => {
    const text = step.text.trim()
    const textMarkup = text === '' ? '' : `<div class="step-text prose">${renderMarkdown(text)}</div>`
    if (step.diff === undefined) {
      return `<div class="step" data-step-index="${stepIndex}">${textMarkup}</div>`
    }

    let files: FileDiffMetadata[]
    try {
      files = parseSectionPatch(step.diff)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Section "${section.title}" has an unparseable diff: ${detail}`)
    }
    fileCount += files.length
    diffs.push({ section: index, step: stepIndex, diff: step.diff })

    const filesMarkup = files
      .map((file, fileIndex) => {
        const stats = fileDiffStats(file)
        return `<details class="file" open>
  <summary class="file-summary">${escapeHtml(fileDiffLabel(file))} <span class="file-stats">+${stats.additions} −${stats.deletions}</span></summary>
  <div class="file-diff" id="section-${index}-step-${stepIndex}-file-${fileIndex}"></div>
</details>`
      })
      .join('\n')

    return `<div class="step" data-step-index="${stepIndex}">${textMarkup}
  <div class="step-files">${filesMarkup}</div>
</div>`
  })

  const markup = `<section class="section" id="section-${index}" data-section-index="${index}">
  <details class="section-fold" open>
    <summary class="section-title">${escapeHtml(section.title)}</summary>
${steps.join('\n')}
  </details>
</section>`
  return { markup, fileCount, diffs }
}

function renderReviewMap(
  titles: string[],
  counts: { sections: number; files: number },
  layoutForm: string,
): string {
  const links = titles
    .map(
      (title, index) =>
        `<li><a href="#section-${index}"><span class="review-map-index">${String(index + 1).padStart(2, '0')}</span><span class="review-map-title">${escapeHtml(title)}</span></a></li>`,
    )
    .join('\n')
  return `<nav class="review-map" aria-label="Review map">
  ${layoutForm}
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
  display: flex;
  margin: 0 10px 20px;
  border: 1px solid #bdcbbf;
  border-radius: 7px;
  overflow: hidden;
  background: #f3f7f3;
}
.layout-form label { flex: 1; padding: 5px 10px; color: #607066; font-size: 13px; text-align: center; cursor: pointer; }
.layout-form input { display: none; }
.layout-form label:has(input:checked) { color: #ffffff; background: var(--accent); font-weight: 600; }
.review-workspace {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  min-height: 100vh;
}
.review-map {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
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
.section { max-width: 1480px; margin: 0 auto 22px; scroll-margin-top: 18px; }
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
.prose { color: #3c4d41; font-size: 14px; }
.step-text { max-width: 900px; padding: 18px 20px 8px; }
.prose strong { color: #142c1d; }
.step-files { padding: 12px; display: grid; gap: 9px; }
.step + .step { border-top: 1px solid #e3ebe5; }
.report-cover {
  max-width: 1480px;
  margin: 0 auto 22px;
  /* 10px plus the last paragraph's 8px margin balances the 24px above it. */
  padding: 24px 24px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 14px 38px rgba(37, 72, 48, .07);
}
.report-cover h1 {
  max-width: 900px;
  margin: 0 0 12px;
  color: #102218;
  font-size: 27px;
  line-height: 1.22;
  letter-spacing: -.02em;
}
.report-cover .source-metadata { max-width: 640px; }
.report-cover .source-metadata dd { white-space: normal; overflow: visible; }
.cover-summary { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.cover-summary > :first-child { margin-top: 0; }
/* The card is as wide as a section so a diagram has room, but prose is capped at the
   same measure as a step's text: a 1400px line is not readable. */
.cover-summary > p, .cover-summary > ul, .cover-summary > ol,
.cover-summary > blockquote { max-width: 900px; }
.prose svg { max-width: 100%; height: auto; }
.prose h1, .prose h2, .prose h3, .prose h4 {
  margin: 16px 0 8px;
  line-height: 1.25;
}
.prose p { margin: 0 0 8px; }
.prose ul, .prose ol { margin: 0 0 8px; padding-left: 24px; }
.prose code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--file-background);
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
.prose pre {
  background: var(--file-background);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  overflow: auto;
}
.prose pre code { background: none; padding: 0; }
.prose blockquote {
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
  .review-workspace { display: block; min-height: 0; }
  /* The map has no room to be a rail, but the toggle still has to be reachable while
     scrolled into a diff, so what survives is a sticky strip holding just the toggle. */
  .review-map {
    top: 0;
    z-index: 10;
    height: auto;
    padding: 8px 12px;
    overflow: visible;
    border-right: none;
    border-bottom: 1px solid var(--border);
    background: rgba(240, 245, 240, .94);
    backdrop-filter: blur(12px);
  }
  .review-map-label, .review-map-list, .review-map-counts { display: none; }
  .layout-form { max-width: 260px; margin: 0 0 0 auto; }
  main { padding: 14px 10px 50px; }
}
@media (max-width: 520px) {
  .report-cover { padding: 18px 16px 8px; }
  .report-cover h1 { font-size: 21px; }
  .layout-form label { padding: 4px 7px; font-size: 11px; }
  .section-fold > summary { font-size: 14px; }
}
@media print {
  .layout-form { display: none; }
  .review-map { display: none; }
  .review-workspace { display: block; }
  .report-cover { box-shadow: none; break-inside: avoid; }
  .source-metadata dd { white-space: normal; overflow: visible; }
  main { padding: 16px; }
  body { background: #ffffff; }
  .section, .file { break-inside: avoid; }
  .file-diff { print-color-adjust: exact; }
  details { border: 1px solid var(--border) !important; }
}
`
