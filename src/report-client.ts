import { FileDiff, type FileDiffMetadata, type FileDiffOptions } from '@pierre/diffs'
import { parseSectionPatch } from './report-patches'

interface ReportDiffMount {
  section: number
  step: number
  diff: string
}

interface ReportData {
  source: unknown
  diffs: ReportDiffMount[]
}

interface MountedDiff {
  fileDiff: FileDiffMetadata
  instance: FileDiff
}

type FileDiffFactory = (options: FileDiffOptions<undefined>) => FileDiff

const initialRenderTimeoutMs = 10_000

function readReportData(): ReportData | null {
  const element = document.querySelector<HTMLScriptElement>(
    'body > script#diffwalk-report-data[type="application/json"]',
  )
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

function showStepError(mount: ReportDiffMount, error: unknown) {
  const step = document.querySelector(
    `[data-section-index="${mount.section}"] [data-step-index="${mount.step}"] .step-files`,
  )
  if (!step) return
  const message = error instanceof Error ? error.message : String(error)
  const note = document.createElement('div')
  note.className = 'diff-error'
  note.textContent = `Could not render this step's diff: ${message}`
  step.appendChild(note)
}

function baseOptions(
  diffStyle: 'split' | 'unified',
  onPostRender?: FileDiffOptions<undefined>['onPostRender'],
) {
  return {
    diffStyle,
    themeType: 'light',
    disableFileHeader: true,
    onPostRender,
  } satisfies FileDiffOptions<undefined>
}

function mountDiffs(
  data: ReportData,
  layout: 'split' | 'unified',
  createFileDiff: FileDiffFactory,
): { mounted: MountedDiff[]; initialRender: Promise<void> } {
  const mounted: MountedDiff[] = []
  const initialRenders: Promise<void>[] = []
  for (const mount of data.diffs) {
    let files: FileDiffMetadata[]
    try {
      files = parseSectionPatch(mount.diff)
    } catch (error) {
      showStepError(mount, error)
      continue
    }
    for (const [fileIndex, fileDiff] of files.entries()) {
      const wrapper = document.querySelector<HTMLElement>(
        `[data-diff-mount="${mount.section}-${mount.step}-${fileIndex}"]`,
      )
      if (!wrapper) continue
      let finishRender!: () => void
      initialRenders.push(
        new Promise<void>((resolve) => {
          let settled = false
          let timeout: ReturnType<typeof setTimeout> | undefined
          finishRender = () => {
            if (settled) return
            settled = true
            if (timeout !== undefined) clearTimeout(timeout)
            resolve()
          }
          timeout = setTimeout(() => {
            timeout = undefined
            finishRender()
          }, initialRenderTimeoutMs)
        }),
      )
      try {
        const instance = createFileDiff(
          baseOptions(layout, (_node, _instance, phase) => {
            if (phase === 'mount') finishRender()
          }),
        )
        instance.render({ fileDiff, containerWrapper: wrapper })
        mounted.push({ fileDiff, instance })
      } catch (error) {
        finishRender()
        showStepError(mount, error)
      }
    }
  }
  return { mounted, initialRender: Promise.all(initialRenders).then(() => {}) }
}

function currentFragment(): string | null {
  if (window.location.hash.length < 2) return null
  try {
    return decodeURIComponent(window.location.hash.slice(1))
  } catch {
    return null
  }
}

function generatedTargets(): HTMLElement[] {
  const targets: HTMLElement[] = []
  for (const section of document.querySelectorAll<HTMLElement>(
    'main > section.section[data-target-kind="section"][id]',
  )) {
    targets.push(section)
    for (const fold of section.children) {
      if (!fold.matches('details.section-fold')) continue
      for (const step of fold.children) {
        if (!step.matches('.step[data-target-kind="step"][id]')) continue
        targets.push(step as HTMLElement)
        for (const actions of step.children) {
          if (!actions.matches('.step-actions')) continue
          for (const change of actions.children) {
            if (change.matches('.change-target[data-target-kind="change"][id]')) {
              targets.push(change as HTMLElement)
            }
          }
        }
      }
    }
  }
  return targets
}

function reserveGeneratedIds() {
  const targets = new Set(generatedTargets())
  const reportData = document.querySelector<HTMLScriptElement>(
    'body > script#diffwalk-report-data[type="application/json"]',
  )
  const preferred = reportData ? new Set<Element>([...targets, reportData]) : targets
  const reserved = new Set([...preferred].map((element) => element.id))
  const seen = new Set<string>()

  for (const element of document.querySelectorAll<HTMLElement>('[id]')) {
    if (preferred.has(element)) {
      seen.add(element.id)
    } else if (reserved.has(element.id) || seen.has(element.id)) {
      element.removeAttribute('id')
    } else {
      seen.add(element.id)
    }
  }
}

function fragmentTarget(): { fragment: string; target: HTMLElement } | null {
  const requested = currentFragment()
  if (requested === null) return null

  let target = generatedTargets().find((candidate) => candidate.id === requested) ?? null
  if (target === null) {
    const legacySection = /^section-(0|[1-9]\d*)$/.exec(requested)
    if (legacySection) {
      target =
        generatedTargets().find(
          (candidate) =>
            candidate.dataset.targetKind === 'section' &&
            candidate.dataset.sectionIndex === legacySection[1],
        ) ?? null
      if (target) {
        const url = new URL(window.location.href)
        url.hash = target.id
        window.history.replaceState(window.history.state, '', url)
      }
    }
  }

  if (!target?.matches('[data-target-kind]')) return null
  return { fragment: target.id, target }
}

function revealFragment(final: boolean) {
  const resolved = fragmentTarget()
  if (resolved === null) return
  const { fragment, target } = resolved

  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.matches('details')) (parent as HTMLDetailsElement).open = true
  }
  if (target.matches('[data-target-kind="section"]')) {
    const sectionFold = target.querySelector<HTMLDetailsElement>('.section-fold')
    if (sectionFold) sectionFold.open = true
  } else {
    const step = target.matches('[data-target-kind="step"]') ? target : target.closest('.step')
    for (const file of step?.querySelectorAll<HTMLDetailsElement>('details.file') ?? []) {
      file.open = true
    }
  }

  if (!final) return
  target.scrollIntoView?.({ block: 'center' })
  const targets = new Set(generatedTargets())
  const focusTarget = [...document.querySelectorAll<HTMLButtonElement>('[data-copy-fragment]')]
    .find((button) => {
      if (button.dataset.copyFragment !== fragment) return false
      for (let owner = button.parentElement; owner; owner = owner.parentElement) {
        if (targets.has(owner)) return owner === target
      }
      return false
    })
  focusTarget?.focus({ preventScroll: true })
}

const feedbackTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>()

function showCopyFeedback(button: HTMLButtonElement, success: boolean) {
  const label = button.querySelector<HTMLElement>('[data-copy-label]')
  const original = label?.dataset.originalLabel ?? label?.textContent ?? 'Link'
  if (label) {
    label.dataset.originalLabel = original
    label.textContent = success ? 'Copied' : 'Failed'
  }
  button.dataset.copyState = success ? 'success' : 'failure'
  const status = document.querySelector<HTMLElement>('[data-copy-status]')
  if (status) status.textContent = success ? 'Link copied to clipboard.' : 'Could not copy link.'

  const previous = feedbackTimers.get(button)
  if (previous !== undefined) clearTimeout(previous)
  feedbackTimers.set(
    button,
    setTimeout(() => {
      if (label) label.textContent = original
      delete button.dataset.copyState
    }, 2000),
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {}
  }

  const field = document.createElement('textarea')
  const active = document.activeElement
  field.value = value
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  let copied = false
  try {
    field.focus()
    field.select()
    copied = document.execCommand?.('copy') ?? false
  } finally {
    field.remove()
    if (active instanceof HTMLElement) active.focus({ preventScroll: true })
  }
  if (!copied) throw new Error('Clipboard access is unavailable')
}

function wireFragments(initialRender: Promise<void>) {
  let rendersComplete = false
  let finalRevealPending = false
  const queueFinalReveal = () => {
    if (!rendersComplete || finalRevealPending) return
    finalRevealPending = true
    requestAnimationFrame(() => {
      finalRevealPending = false
      revealFragment(true)
    })
  }
  const navigate = () => {
    revealFragment(false)
    queueFinalReveal()
  }

  window.addEventListener('hashchange', navigate)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-fragment]')) {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const url = new URL(window.location.href)
      url.hash = button.dataset.copyFragment!
      void copyText(url.href).then(
        () => showCopyFeedback(button, true),
        () => showCopyFeedback(button, false),
      )
    })
  }
  document.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return

    const link = origin.closest<HTMLAnchorElement>('a[href^="#"]')
    if (link && new URL(link.href).hash === window.location.hash) navigate()
  })
  navigate()
  void initialRender.then(() => {
    rendersComplete = true
    queueFinalReveal()
  })
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

export function mountReport(
  createFileDiff: FileDiffFactory = (options) => new FileDiff(options),
) {
  reserveGeneratedIds()
  const data = readReportData()
  if (!data) return
  let layout = initialLayout()
  if (isNarrowViewport() && layout === 'split') {
    layout = 'unified'
    reflectLayout(layout)
  }
  let finishInitialRender!: () => void
  const initialRender = new Promise<void>((resolve) => (finishInitialRender = resolve))
  wireFragments(initialRender)
  const mountedDiffs = mountDiffs(data, layout, createFileDiff)
  void mountedDiffs.initialRender.then(finishInitialRender)
  const { mounted } = mountedDiffs
  wireLayout(mounted)
  prepareForPrint()
}

if (typeof document !== 'undefined') {
  mountReport()
}
