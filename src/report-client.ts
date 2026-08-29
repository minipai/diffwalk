import { FileDiff, type FileDiffMetadata, type FileDiffOptions } from '@pierre/diffs'
import { parseSectionPatch } from './report-patches'

interface ReportData {
  source: unknown
  sections: { diff: string; fileCount: number }[]
}

interface MountedDiff {
  fileDiff: FileDiffMetadata
  instance: FileDiff
}

function readReportData(): ReportData | null {
  const element = document.getElementById('diffwalk-report-data')
  if (!element?.textContent) return null
  return JSON.parse(element.textContent) as ReportData
}

function initialLayout(): 'split' | 'unified' {
  const form = document.querySelector<HTMLFormElement>('[data-layout-form]')
  const checked = form?.querySelector<HTMLInputElement>('input[name="layout"]:checked')
  return checked?.value === 'unified' ? 'unified' : 'split'
}

function isNarrowViewport(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches
}

function reflectLayout(value: 'split' | 'unified') {
  const form = document.querySelector<HTMLFormElement>('[data-layout-form]')
  const input = form?.querySelector<HTMLInputElement>(`input[name="layout"][value="${value}"]`)
  if (input) input.checked = true
}

function showSectionError(sectionIndex: number, error: unknown) {
  const section = document.querySelector(`[data-section-index="${sectionIndex}"]`)
  const files = section?.querySelector('.section-files')
  if (!files) return
  const message = error instanceof Error ? error.message : String(error)
  const note = document.createElement('div')
  note.className = 'diff-error'
  note.textContent = `Could not render this section's diff: ${message}`
  files.appendChild(note)
}

function baseOptions(diffStyle: 'split' | 'unified') {
  return {
    diffStyle,
    themeType: 'light',
    disableFileHeader: true,
  } satisfies FileDiffOptions<undefined>
}

function mountSections(data: ReportData, layout: 'split' | 'unified'): MountedDiff[] {
  const mounted: MountedDiff[] = []
  for (const [sectionIndex, section] of data.sections.entries()) {
    let files: FileDiffMetadata[]
    try {
      files = parseSectionPatch(section.diff)
    } catch (error) {
      showSectionError(sectionIndex, error)
      continue
    }
    for (const [fileIndex, fileDiff] of files.entries()) {
      const wrapper = document.getElementById(`section-${sectionIndex}-file-${fileIndex}`)
      if (!wrapper) continue
      const instance = new FileDiff(baseOptions(layout))
      instance.render({ fileDiff, containerWrapper: wrapper })
      mounted.push({ fileDiff, instance })
    }
  }
  return mounted
}

function wireLayout(mounted: MountedDiff[]) {
  const form = document.querySelector<HTMLFormElement>('[data-layout-form]')
  form?.addEventListener('change', (event) => {
    if (!(event.target as Element).matches('input[name="layout"]')) return
    const submitter = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    form.requestSubmit(submitter ?? undefined)
  })
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = new FormData(form).get('layout')
    if (value !== 'split' && value !== 'unified') return
    for (const { fileDiff, instance } of mounted) {
      instance.setOptions({ ...instance.options, diffStyle: value })
      instance.render({ fileDiff, forceRender: true })
    }
  })
}

function prepareForPrint() {
  window.addEventListener('beforeprint', () => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>('details')) {
      details.open = true
    }
  })
}

export function mountReport() {
  const data = readReportData()
  if (!data) return
  let layout = initialLayout()
  if (isNarrowViewport() && layout === 'split') {
    layout = 'unified'
    reflectLayout(layout)
  }
  const mounted = mountSections(data, layout)
  wireLayout(mounted)
  prepareForPrint()
}

if (typeof document !== 'undefined') {
  mountReport()
}
