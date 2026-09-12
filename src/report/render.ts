import type { ExplainDocument } from '../format/types'
import { faviconDataUrl } from './favicon'
import { renderMarkdown } from './markdown'
import { fileDiffLabel, fileDiffStats, parseSectionPatch } from './patches'
import { reportTargets, type ReportSectionTarget } from './targets'
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
    renderReportBody(document, options, true),
    `<link rel="stylesheet" href="${escapeHtml(assets.stylesHref)}">`,
    `<script src="${escapeHtml(assets.clientSrc)}" defer></script>`,
  )
}

function renderReportBody(
  document: ExplainDocument,
  options: ReportOptions = {},
  hosted = false,
): ReportBody {
  const title = options.title ?? document.title
  const layout = options.layout ?? 'split'
  const targets = reportTargets(document)
  const sections = document.sections.map((section, index) =>
    renderSection(section, index, targets[index]!),
  )
  const files = sections.reduce((total, section) => total + section.fileCount, 0)
  const layoutForm = `<form class="layout-form" data-layout-form aria-label="Diff layout">
    <label><input type="radio" name="layout" value="split" ${layout === 'split' ? 'checked' : ''}> Split</label>
    <label><input type="radio" name="layout" value="unified" ${layout === 'unified' ? 'checked' : ''}> Unified</label>
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>`
  const foldAll = `<button type="button" class="fold-all" data-fold-all aria-label="Fold all review sections"><span data-fold-all-label>Fold all</span></button>`
  const readingControls = `<div class="review-controls">${layoutForm}${foldAll}</div>`
  const reviewMap = renderReviewMap(
    document.sections.map((section, index) => ({
      title: section.title,
      fragment: targets[index]!.fragment,
    })),
    { sections: sections.length, files },
    readingControls,
  )
  const summary =
    document.summary.trim() === ''
      ? ''
      : `\n  <div class="cover-summary prose">${renderMarkdown(document.summary)}</div>`
  // Title, provenance, attribution, and summary are one opening, so they share one card.
  // The layout toggle lives in the sticky map instead: it is a reading control, wanted
  // while scrolled into a diff, and the card scrolls away.
  const markup = `<div class="review-workspace">
${reviewMap}
<main>
<section class="report-cover">
  <h1>${escapeHtml(title)}</h1>
  <dl class="source-metadata">
    ${renderSourceMetadata(document.source)}
  </dl>${renderAttribution(document.metadata, hosted)}${summary}
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

function renderShell(body: ReportBody, styles: string, client: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${faviconDataUrl}" type="image/svg+xml">
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

function renderSection(
  section: ExplainDocument['sections'][number],
  index: number,
  target: ReportSectionTarget,
): {
  markup: string
  fileCount: number
  diffs: ReportDiffMount[]
} {
  const diffs: ReportDiffMount[] = []
  let fileCount = 0

  const steps = section.steps.map((step, stepIndex) => {
    const stepTarget = target.steps[stepIndex]!
    const text = step.text.trim()
    const textMarkup = text === '' ? '' : `<div class="step-text prose">${renderMarkdown(text)}</div>`
    const changeTargets = stepTarget.changes
      .filter((change) => change.canonical)
      .map(
        (change) =>
          `<span class="change-target" id="${change.fragment}" data-target-kind="change"></span>`,
      )
      .join('')
    const actions = `<div class="step-actions">
    ${renderPermalink(stepTarget.fragment, `Permalink to step ${stepIndex + 1} in ${section.title}`, 'LINK')}${changeTargets}
  </div>`
    if (step.diff === undefined) {
      return `<div class="step" id="${stepTarget.fragment}" data-step-index="${stepIndex}" data-target-kind="step">${actions}${textMarkup}</div>`
    }

    const files = parseStepDiff(step.diff, section.title)
    fileCount += files.length
    diffs.push({ section: index, step: stepIndex, diff: step.diff })

    const filesMarkup = files
      .map((file, fileIndex) => {
        const stats = fileDiffStats(file)
        const pureRename = file.type === 'rename-pure' && file.hunks.length === 0
        const label = escapeHtml(fileDiffLabel(file))
        if (pureRename) {
          return `<div class="file file-static">
  <div class="file-summary">${label} <span class="file-stats">Renamed · content unchanged</span></div>
</div>`
        }
        return `<details class="file" open>
  <summary class="file-summary">${label} <span class="file-stats">+${stats.additions} −${stats.deletions}</span></summary>
  <div class="file-diff" data-diff-mount="${index}-${stepIndex}-${fileIndex}"></div>
</details>`
      })
      .join('\n')

    return `<div class="step" id="${stepTarget.fragment}" data-step-index="${stepIndex}" data-target-kind="step">${actions}${textMarkup}
  <div class="step-files">${filesMarkup}</div>
</div>`
  })

  const markup = `<section class="section" id="${target.fragment}" data-section-index="${index}" data-target-kind="section">
  <details class="section-fold" open>
    <summary class="section-title" tabindex="-1"><button type="button" class="section-toggle" aria-expanded="true" aria-controls="${target.fragment}" aria-label="Toggle section ${sectionIndex(index)}: ${escapeHtml(section.title)}"><span class="section-toggle-arrow" aria-hidden="true">▾</span> <span class="section-title-index">${sectionIndex(index)}</span></button><a class="section-title-text" href="#${target.fragment}">${escapeHtml(section.title)}</a></summary>
${steps.join('\n')}
  </details>
</section>`
  return { markup, fileCount, diffs }
}

function parseStepDiff(diff: string, sectionTitle: string): FileDiffMetadata[] {
  try {
    return parseSectionPatch(diff)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Section "${sectionTitle}" has an unparseable diff: ${detail}`)
  }
}

function renderReviewMap(
  sections: { title: string; fragment: string }[],
  counts: { sections: number; files: number },
  controls: string,
): string {
  const links = sections
    .map(
      (section, index) =>
        `<li><a href="#${section.fragment}"><span class="review-map-index">${sectionIndex(index)}</span><span class="review-map-title">${escapeHtml(section.title)}</span></a></li>`,
    )
    .join('\n')
  return `<nav class="review-map" aria-label="Review map">
  ${controls}
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

function renderPermalink(fragment: string, label: string, text: string): string {
  return `<a class="permalink" href="#${fragment}" aria-label="${escapeHtml(label)}">${escapeHtml(text)}</a>`
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function sectionIndex(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function renderAttribution(metadata: ExplainDocument['metadata'], hosted: boolean): string {
  if (metadata === undefined) return ''
  const rows: string[] = []
  if (metadata.explainedBy !== undefined) {
    rows.push(`<dt>Explained by</dt><dd>${escapeHtml(metadata.explainedBy)}</dd>`)
  }
  // A local preview or export must not claim a publisher or a publication time, even if
  // a document somehow carries one. Only the review service renders those rows.
  if (hosted && metadata.publishedBy !== undefined) {
    rows.push(`<dt>Published by</dt><dd>${escapeHtml(metadata.publishedBy)}</dd>`)
  }
  if (hosted && metadata.publishedAt !== undefined) {
    rows.push(`<dt>Published at</dt><dd>${escapeHtml(metadata.publishedAt)}</dd>`)
  }
  if (rows.length === 0) return ''
  return `
  <dl class="attribution-metadata">
    ${rows.join('\n    ')}
  </dl>
  <p class="attribution-note">The names are self-reported attribution, not verified identity.</p>`
}

function renderSourceMetadata(source: ExplainDocument['source']): string {
  switch (source.kind) {
    case 'commit-diff':
      return `<dt>From</dt><dd>${renderEndpoint(source.from)}</dd>
    <dt>To</dt><dd>${renderEndpoint(source.to)}</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
    case 'working-tree':
      return `<dt>From</dt><dd>${renderEndpoint(source.from)}</dd>
    <dt>To</dt><dd>Working tree</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
    case 'proposal':
      return `<dt>Source</dt><dd>Proposal</dd>
    <dt>Captured at</dt><dd>${escapeHtml(source.capturedAt)}</dd>`
  }
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
  font-size: 14px;
  line-height: 1.5;
}
.source-metadata dt { color: #7e8d82; font-weight: 500; }
.source-metadata dd { margin: 0; min-width: 0; overflow: hidden; color: #4e5d53; text-overflow: ellipsis; white-space: nowrap; }
.source-metadata code { font: inherit; }
.attribution-metadata {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0 8px;
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.5;
}
.attribution-metadata dt { color: #7e8d82; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
.attribution-metadata dd { min-width: 0; margin: 0; color: #4e5d53; overflow-wrap: anywhere; }
.attribution-note { margin: 6px 0 0; color: #7e8d82; font-size: 11px; font-style: italic; }
.review-controls {
  display: grid;
  gap: 8px;
  margin: 0 10px 20px;
}
.layout-form {
  display: flex;
  margin: 0;
  border: 1px solid #bdcbbf;
  border-radius: 7px;
  overflow: hidden;
  background: #f3f7f3;
}
.layout-form label { flex: 1; padding: 5px 10px; color: #607066; font-size: 13px; text-align: center; cursor: pointer; }
.layout-form input { display: none; }
.layout-form label:has(input:checked) { color: #ffffff; background: var(--accent); font-weight: 600; }
.fold-all {
  padding: 6px 10px;
  border: 1px solid #bdcbbf;
  border-radius: 7px;
  color: #53665a;
  background: #f3f7f3;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.fold-all:hover { color: var(--accent); border-color: #8eaa95; background: #eef5ef; }
.fold-all:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  display: flex;
  align-items: baseline;
  gap: 12px;
  overflow-wrap: anywhere;
  padding: 12px 16px;
  border-bottom: 1px solid transparent;
  color: #17271c;
  font-size: 18px;
  font-weight: 600;
  list-style: none;
  user-select: text;
  -webkit-user-select: text;
}
.section-toggle { flex: none; border: 0; padding: 4px 0; background: transparent; color: var(--accent); font: inherit; cursor: pointer; user-select: none; }
.section-title-index { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82em; }
.section-title-text { min-width: 0; color: inherit; text-decoration: none; }
.section-title-text:hover { text-decoration: underline; }
.section-toggle:focus-visible, .section-title-text:focus-visible, .permalink:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.section-fold > summary::-webkit-details-marker { display: none; }
.section-fold[open] > summary { border-bottom-color: var(--border); }
.prose { color: #3c4d41; font-size: 14px; }
.step { position: relative; scroll-margin-top: 18px; }
.step-actions { position: absolute; top: 8px; right: 12px; z-index: 2; }
.step-text { max-width: 900px; padding: 8px 68px 8px 20px; font-size: 17px; }
.permalink { display: block; padding: 2px 3px; color: #98a29c; font: 600 10px/20px ui-monospace, SFMono-Regular, Menlo, monospace; text-decoration: none; }
.permalink:hover, .permalink:focus-visible { color: var(--accent); }
.change-target { position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: hidden; scroll-margin-top: 18px; }
.step:not(:has(.step-text)) .step-files { padding-right: 68px; }
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
.cover-summary { font-size: 17px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
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
.file-summary {
  padding: 8px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: #314439;
  background: #f3f7f3;
}
.file > summary {
  cursor: pointer;
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
  .review-controls { display: flex; gap: 6px; justify-content: flex-end; margin: 0; }
  .layout-form { flex: 1 1 auto; max-width: 220px; margin: 0 0 0 auto; }
  .fold-all { flex: none; padding: 5px 9px; font-size: 12px; }
  /* The aligned fragment target must clear the sticky strip, so push its
     scroll-margin past the strip plus breathing room. */
  .section, .step, .change-target { scroll-margin-top: 64px; }
  main { padding: 14px 10px 50px; }
}
@media (max-width: 520px) {
  .report-cover { padding: 18px 16px 8px; }
  .report-cover h1 { font-size: 21px; }
  .layout-form label { padding: 4px 7px; font-size: 11px; }
  .fold-all { padding: 4px 7px; font-size: 11px; }
  .section-fold > summary { font-size: 17px; }
}
@media print {
  .layout-form, .permalink { display: none; }
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
