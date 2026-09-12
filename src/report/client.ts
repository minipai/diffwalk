import { FileDiff, type FileDiffMetadata, type FileDiffOptions } from '@pierre/diffs'
import { parseSectionPatch } from './patches'

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
  wireSectionFolds()
  wireFragments(initialRender)
  const mountedDiffs = mountDiffs(data, layout, createFileDiff)
  void mountedDiffs.initialRender.then(finishInitialRender)
  const { mounted } = mountedDiffs
  wireLayout(mounted)
  wireGlobalFolds()
  prepareForPrint()
}

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
  const { target } = resolved

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
  // Align the target's leading edge (its title or marker). Centering a target
  // taller than the viewport would push that edge far off-screen.
  target.scrollIntoView?.({ block: 'start' })
  const owner = target.matches('[data-target-kind="change"]') ? target.closest('.step') : target
  const link = owner?.querySelector<HTMLAnchorElement>('a.section-title-text, a.permalink')
  link?.focus({ preventScroll: true })
}

function wireSectionFolds() {
  for (const fold of sectionFolds()) {
    const summary = fold.querySelector<HTMLElement>(':scope > summary')!
    const button = summary.querySelector<HTMLButtonElement>('.section-toggle')!
    const arrow = button.querySelector<HTMLElement>('.section-toggle-arrow')!
    const sync = () => {
      button.setAttribute('aria-expanded', String(fold.open))
      arrow.textContent = fold.open ? '▾' : '▸'
    }
    summary.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('a')) event.preventDefault()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      fold.open = !fold.open
      sync()
    })
    fold.addEventListener('toggle', sync)
    sync()
  }
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
  document.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return

    const link = origin.closest<HTMLAnchorElement>('a[href^="#"]')
    if (link && new URL(link.href).hash === window.location.hash) {
      // A section permalink lives inside its <summary>; the browser's default
      // action can toggle that fold after the click dispatch. Let it settle, then
      // reopen ancestors and realign the title on the next task.
      setTimeout(navigate, 0)
    }
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

// The global control is one toggle: it folds every section while any is open and
// unfolds them once they are all closed. It only touches `open` on existing section
// folds, so the report data is untouched and a single section still toggles natively.
function sectionFolds(): HTMLDetailsElement[] {
  return [...document.querySelectorAll<HTMLDetailsElement>('details.section-fold')]
}

// The focused child of a fold that just closed is no longer rendered, but browsers can
// leave focus on it. Only the fold's own summary row stays visible.
function hiddenByClosedFold(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (!node.matches('details:not([open])')) continue
    const summary = node.querySelector(':scope > summary')
    // A closed details hides its content but not its own summary row, so keep
    // walking: an outer closed details can still hide that summary.
    if (summary && (summary === element || summary.contains(element))) continue
    return true
  }
  return false
}

function wireGlobalFolds() {
  const button = document.querySelector<HTMLButtonElement>('[data-fold-all]')
  if (!button) return
  const label = button.querySelector<HTMLElement>('[data-fold-all-label]')
  const folds = sectionFolds()
  if (folds.length === 0) return

  const allFolded = () => folds.every((fold) => !fold.open)
  const sync = () => {
    const folded = allFolded()
    if (label) label.textContent = folded ? 'Unfold all' : 'Fold all'
    button.setAttribute(
      'aria-label',
      folded ? 'Unfold all review sections' : 'Fold all review sections',
    )
  }

  button.addEventListener('click', () => {
    // Read focus before closing: a browser blurs a descendant the moment its
    // ancestor details closes, so afterwards activeElement may already be body.
    const active = document.activeElement
    const unfold = allFolded()
    for (const fold of folds) fold.open = unfold
    if (active instanceof HTMLElement && hiddenByClosedFold(active)) {
      const section = active.closest('details.section-fold')
      const summary = section?.querySelector<HTMLElement>('.section-toggle')
      ;(summary ?? button).focus({ preventScroll: true })
    }
    sync()
  })
  for (const fold of folds) fold.addEventListener('toggle', sync)
  sync()
}

function prepareForPrint() {
  window.addEventListener('beforeprint', () => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>('details')) {
      details.open = true
    }
  })
}


if (typeof document !== 'undefined') {
  mountReport()
}
