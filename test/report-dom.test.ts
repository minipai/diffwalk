import { afterEach, describe, expect, test } from 'bun:test'
import type { FileDiff } from '@pierre/diffs'
import { Window } from 'happy-dom'
import type { ExplainDocument } from '../src/format/types'
import { loadReportClient, renderReport } from '../src/report'
import { mountReport } from '../src/report/client'
import { reportTargets } from '../src/report/targets'

const clientBundle = await loadReportClient()

const windows: Window[] = []

afterEach(() => {
  windows.splice(0).forEach((dom) => dom.happyDOM.cancelAsync())
})

function simplePatch(oldLine = 'old', newLine = 'new'): string {
  return [
    'diff --git a/example.ts b/example.ts',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -1 +1 @@',
    `-${oldLine}`,
    `+${newLine}`,
    '',
  ].join('\n')
}

function pureRenamePatch(): string {
  return [
    'diff --git a/old-name.ts b/new-name.ts',
    'rename from old-name.ts',
    'rename to new-name.ts',
    '',
  ].join('\n')
}

function section(patch: string, title: string, options: { text?: string } = {}) {
  return {
    title,
    steps: [{ text: options.text ?? 'A complete explanation on its own.', diff: patch }],
  }
}

function document(sections: ExplainDocument['sections']): ExplainDocument {
  return {
    formatVersion: 1,
    title: 'A change set',
    summary: '',
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections,
  }
}

function shellWithoutClient(html: string): string {
  const clientStart = html.lastIndexOf('<script>')
  const clientEnd = html.lastIndexOf('</script>')
  return html.slice(0, clientStart) + html.slice(clientEnd + '</script>'.length)
}

function loadReport(
  html: string,
  options: { narrow?: boolean; url?: string } = {},
): Window {
  const dom = new Window({ url: options.url ?? 'file:///tmp/diffwalk-report.html' })
  windows.push(dom)
  const win = dom.window
  const anyWindow = win as unknown as Record<string, unknown>
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'SVGElement',
    'HTMLPreElement',
    'Node',
    'Element',
    'customElements',
    'CustomEvent',
    'FormData',
    'CSSStyleSheet',
  ]) {
    ;(globalThis as unknown as Record<string, unknown>)[key] = anyWindow[key]
  }
  ;(globalThis as unknown as Record<string, unknown>).self = win
  ;(globalThis as unknown as Record<string, unknown>).navigator = win.navigator
  globalThis.getComputedStyle = win.getComputedStyle.bind(
    win,
  ) as unknown as typeof getComputedStyle
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as unknown as typeof cancelAnimationFrame
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  const narrow = options.narrow ?? false
  globalThis.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof matchMedia
  dom.document.write(shellWithoutClient(html))
  dom.document.close()
  return dom
}

function runReportClient() {
  ;(0, eval)(clientBundle)
}

async function waitFor(condition: () => boolean, timeout = 30000, interval = 50) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('waitFor timed out')
}

async function waitForQuiescent(dom: Window, timeout = 30000) {
  const signature = () => [0, 1, 2].map((index) => `${index}:${codeColumns(dom, index)}`).join('|')
  let last = signature()
  let since = Date.now()
  while (Date.now() - since < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const now = signature()
    if (now === last) {
      if (Date.now() - since >= 800) return last
    } else {
      last = now
      since = Date.now()
    }
  }
  throw new Error('waitForQuiescent timed out')
}

function fileDiffShadow(dom: Window, index: number) {
  const doc = dom.document as unknown as Document
  const wrapper = doc.querySelectorAll('.file-diff')[index]
  const container = wrapper?.querySelector('diffs-container')
  return container?.shadowRoot ?? null
}

function mountedCount(dom: Window) {
  const doc = dom.document as unknown as Document
  return [...doc.querySelectorAll('.file-diff')].filter((wrapper) => {
    if (wrapper.shadowRoot != null) return false
    return wrapper.querySelector('diffs-container')?.shadowRoot?.querySelector('pre') != null
  }).length
}

function codeColumns(dom: Window, index: number) {
  const shadow = fileDiffShadow(dom, index)
  return shadow ? shadow.querySelectorAll('pre > code').length : -1
}

function submitLayout(dom: Window, value: 'split' | 'unified') {
  const doc = dom.document as unknown as Document
  const input = doc.querySelector<HTMLInputElement>(`input[name="layout"][value="${value}"]`)
  input!.checked = true
  input!.dispatchEvent(
    new dom.window.Event('change', { bubbles: true, cancelable: true }) as unknown as Event,
  )
}

function diffContainers(dom: Window) {
  const doc = dom.document as unknown as Document
  return [...doc.querySelectorAll('.file-diff diffs-container')]
}

function expectSameContainers(before: Element[], after: Element[]) {
  expect(after).toHaveLength(before.length)
  for (let index = 0; index < before.length; index++) {
    expect(after[index]).toBe(before[index])
  }
}

describe('report browser client', () => {
  test('leaves a legacy pure rename as a static file row with no mount target', () => {
    const html = renderReport(document([section(pureRenamePatch(), 'Rename')]), clientBundle)
    const dom = loadReport(html)
    runReportClient()
    const doc = dom.document as unknown as Document

    expect(doc.querySelector('.file-summary')?.textContent).toContain(
      'old-name.ts → new-name.ts Renamed · content unchanged',
    )
    expect(doc.querySelector('.file-static')).not.toBeNull()
    expect(doc.querySelector('.file-static summary')).toBeNull()
    expect(doc.querySelector('.file-static')?.matches('details')).toBe(false)
    expect(doc.querySelector('.file-diff')).toBeNull()
    expect(doc.querySelector('diffs-container')).toBeNull()
    expect([...doc.querySelectorAll('.review-map-counts span')].map((span) => span.textContent)).toEqual(
      ['1 section', '1 file'],
    )
  })

  test('a step without text has no prose block and still exposes its files', () => {
    const html = renderReport(
      document([{ title: 'Diff only', steps: [{ text: '', diff: simplePatch() }] }]),
      clientBundle,
    )
    const dom = loadReport(html)
    const doc = dom.document as unknown as Document

    expect(doc.querySelector('.step')?.querySelector('.step-text')).toBeNull()
    expect(doc.querySelector('div[data-diff-mount="0-0-0"]')).not.toBeNull()
  })

  test('review map anchors resolve to section ids in document order with counts', () => {
    const value = document([
      section(simplePatch('a', 'b'), 'First section'),
      section([simplePatch('c', 'd'), simplePatch('e', 'f')].join(''), 'Second section'),
    ])
    const html = renderReport(value, clientBundle)
    const dom = loadReport(html)
    const doc = dom.document as unknown as Document
    const targets = reportTargets(value)

    const links = doc.querySelectorAll('.review-map a')
    expect(links).toHaveLength(2)
    expect([...links].map((link) => link.getAttribute('href'))).toEqual([
      `#${targets[0]!.fragment}`,
      `#${targets[1]!.fragment}`,
    ])
    expect([...links].map((link) => link.querySelector('.review-map-index')?.textContent)).toEqual(
      ['01', '02'],
    )
    for (const link of links) {
      const href = link.getAttribute('href')!
      expect(doc.getElementById(href.slice(1))).not.toBeNull()
    }
    const counts = [...doc.querySelectorAll('.review-map-counts span')].map(
      (span) => span.textContent,
    )
    expect(counts).toEqual(['2 sections', '3 files'])
  })

  test('initial change hashes reveal folded content, scroll, and focus the canonical action', async () => {
    const value = document([
      {
        title: 'Folded target',
        steps: [{ text: 'Target this change.', diff: simplePatch(), changes: ['change-004'] }],
      },
    ])
    const fragment = reportTargets(value)[0]!.steps[0]!.changes[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const details = [...doc.querySelectorAll<HTMLDetailsElement>('details')]
    for (const fold of details) fold.open = false
    const target = doc.getElementById(fragment) as HTMLElement
    let scrollCount = 0
    target.scrollIntoView = () => {
      scrollCount++
    }

    runReportClient()

    expect(details.every((fold) => fold.open)).toBe(true)
    await waitFor(() => scrollCount === 1)
    expect(scrollCount).toBe(1)
    expect(doc.activeElement).toBe(
      target.closest('.step')!.querySelector('.step-actions > a'),
    )
  })

  test('hashchange reveals a folded step and its files without replacing fold controls', async () => {
    const value = document([
      {
        title: 'Navigate later',
        steps: [{ text: 'Target this step.', diff: simplePatch() }],
      },
    ])
    const fragment = reportTargets(value)[0]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: 'https://reports.example/r/report-id',
    })
    const doc = dom.document as unknown as Document
    runReportClient()
    const details = [...doc.querySelectorAll<HTMLDetailsElement>('details')]
    for (const fold of details) fold.open = false
    const target = doc.getElementById(fragment) as HTMLElement
    let scrollCount = 0
    target.scrollIntoView = () => {
      scrollCount++
    }

    dom.window.location.hash = fragment
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'))

    expect(details.every((fold) => fold.open)).toBe(true)
    await waitFor(() => scrollCount > 0)
    expect(scrollCount).toBeGreaterThan(0)
    expect(doc.activeElement).toBe(
      doc.querySelector(`:is(a.section-title-text, a.permalink)[href="#${fragment}"]`),
    )
    expect(doc.querySelector('.section-fold > summary')).not.toBeNull()
    expect(doc.querySelector('.file > summary')).not.toBeNull()
  })

  test('legacy positional review-map hashes migrate to the matching canonical section', async () => {
    const value = document([
      section(simplePatch('one', 'one!'), 'First'),
      section(simplePatch('two', 'two!'), 'Second'),
    ])
    const fragment = reportTargets(value)[1]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: 'https://reports.example/r/report-id#section-1',
    })
    const doc = dom.document as unknown as Document
    const target = doc.getElementById(fragment) as HTMLElement
    const fold = target.querySelector<HTMLDetailsElement>('.section-fold')!
    fold.open = false
    let scrolled = false
    target.scrollIntoView = () => {
      scrolled = true
    }

    runReportClient()

    expect(dom.window.location.hash).toBe(`#${fragment}`)
    expect(fold.open).toBe(true)
    await waitFor(() => scrolled)
    expect(scrolled).toBe(true)
    expect(doc.activeElement).toBe(
      doc.querySelector(`:is(a.section-title-text, a.permalink)[href="#${fragment}"]`),
    )
  })

  test('authored summary and step IDs cannot shadow or duplicate canonical targets', async () => {
    const value = document([
      {
        title: 'Reserved IDs',
        steps: [
          {
            text: '<span class="change-target" data-target-kind="change" data-step-collision id="change-001">Authored step collision</span>',
            diff: simplePatch(),
            changes: ['change-001'],
          },
        ],
      },
    ])
    value.summary = '<span class="change-target" data-target-kind="change" data-summary-collision id="change-001">Authored summary collision</span>'
    const dom = loadReport(renderReport(value, clientBundle), {
      url: 'https://reports.example/r/report-id#change-001',
    })
    const doc = dom.document as unknown as Document
    expect(doc.querySelectorAll('[id="change-001"]')).toHaveLength(3)
    const target = doc.querySelector<HTMLElement>(
      '.step-actions > .change-target[data-target-kind="change"]',
    )!
    let scrolled = false
    target.scrollIntoView = () => {
      scrolled = true
    }

    runReportClient()
    await waitFor(() => scrolled)

    expect(doc.querySelector('[data-summary-collision]')?.hasAttribute('id')).toBe(false)
    expect(doc.querySelector('[data-step-collision]')?.hasAttribute('id')).toBe(false)
    expect([...doc.querySelectorAll('[id="change-001"]')]).toEqual([target])
    const ids = [...doc.querySelectorAll<HTMLElement>('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(doc.activeElement).toBe(target.closest('.step')!.querySelector('.step-actions > a'))
  })

  test('a direct load aligns a viewport-taller section title instead of centering the section', async () => {
    const value = document([section(simplePatch(), 'Long section')])
    const fragment = reportTargets(value)[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const sectionTarget = doc.getElementById(fragment) as HTMLElement

    // Model the browser scroll: the section starts far down the document and is
    // taller than the viewport, exactly the shape reported in the ticket.
    const viewportHeight = 577
    const sectionTop = 124_086
    const sectionHeight = 58_144
    const optionsSeen: ScrollIntoViewOptions[] = []
    let scrollTop = 0
    sectionTarget.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
      optionsSeen.push(options ?? {})
      const block = options?.block ?? 'start'
      scrollTop =
        block === 'center'
          ? sectionTop + sectionHeight / 2 - viewportHeight / 2
          : block === 'end'
            ? sectionTop + sectionHeight - viewportHeight
            : sectionTop
    }) as typeof sectionTarget.scrollIntoView

    runReportClient()
    await waitFor(() => optionsSeen.length > 0)

    expect(optionsSeen).toEqual([{ block: 'start' }])
    // The section title is the section's leading edge; after alignment it sits at
    // the top of the viewport instead of thousands of pixels above it.
    const titleTopInViewport = sectionTop - scrollTop
    expect(titleTopInViewport).toBeGreaterThanOrEqual(0)
    expect(titleTopInViewport).toBeLessThan(viewportHeight)
  })

  test('clicking a permalink for the current fragment repositions it without centering', async () => {
    const value = document([section(simplePatch(), 'Reveal me')])
    const fragment = reportTargets(value)[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const sectionTarget = doc.getElementById(fragment) as HTMLElement
    const sectionFold = sectionTarget.querySelector<HTMLDetailsElement>('.section-fold')!
    const calls: ScrollIntoViewOptions[] = []
    sectionTarget.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
      calls.push(options ?? {})
    }) as typeof sectionTarget.scrollIntoView

    runReportClient()
    await waitFor(() => calls.length === 1)

    const anchor = doc.querySelector<HTMLAnchorElement>(`:is(a.section-title-text, a.permalink)[href="#${fragment}"]`)
    expect(anchor).not.toBeNull()
    expect(anchor!.tagName).toBe('A')
    expect(anchor!.getAttribute('href')).toBe(`#${fragment}`)

    // Simulate the settled result of any summary toggle before the correction.
    sectionFold.open = false
    calls.length = 0
    anchor!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await waitFor(() => calls.length === 1)

    expect(sectionFold.open).toBe(true)
    expect(calls[0]).toEqual({ block: 'start' })
  })

  test('clicking a folded step permalink opens its ancestors and aligns the step', async () => {
    const value = document([
      {
        title: 'Navigate by link',
        steps: [{ text: 'Target this step.', diff: simplePatch() }],
      },
    ])
    const fragment = reportTargets(value)[0]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: 'https://reports.example/r/report-id',
    })
    const doc = dom.document as unknown as Document
    runReportClient()
    const step = doc.getElementById(fragment) as HTMLElement
    const sectionFold = step.closest<HTMLDetailsElement>('.section-fold')!
    const fileFold = step.querySelector<HTMLDetailsElement>('details.file')!
    sectionFold.open = false
    fileFold.open = false
    const calls: ScrollIntoViewOptions[] = []
    step.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
      calls.push(options ?? {})
    }) as typeof step.scrollIntoView

    const anchor = doc.querySelector<HTMLAnchorElement>(`:is(a.section-title-text, a.permalink)[href="#${fragment}"]`)!
    expect(anchor.tagName).toBe('A')
    anchor.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event,
    )

    await waitFor(() => calls.length === 1)
    expect(sectionFold.open).toBe(true)
    expect(fileFold.open).toBe(true)
    expect(step.scrollIntoView).toBeDefined()
    expect(calls[0]).toEqual({ block: 'start' })
  })

  test('a target after a large async diff is aligned only after every render settles', async () => {
    const large = Array.from({ length: 400 }, (_, index) => `-line ${index}\n+LINE ${index}`).join(
      '\n',
    )
    const bigPatch = [
      'diff --git a/big.ts b/big.ts',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -1,400 +1,400 @@',
      large,
      '',
    ].join('\n')
    const value = document([
      section(bigPatch, 'Large first section'),
      { title: 'Later target', steps: [{ text: 'The real target.', diff: simplePatch() }] },
    ])
    const targets = reportTargets(value)
    const fragment = targets[1]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const first = doc.getElementById(targets[0]!.fragment) as HTMLElement
    const second = doc.getElementById(fragment) as HTMLElement
    const calls: { element: Element; options: ScrollIntoViewOptions }[] = []
    first.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
      calls.push({ element: first, options: options ?? {} })
    }) as typeof first.scrollIntoView
    second.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
      calls.push({ element: second, options: options ?? {} })
    }) as typeof second.scrollIntoView

    runReportClient()
    await waitFor(() => calls.length > 0)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.element).toBe(second)
    expect(calls[0]!.options).toEqual({ block: 'start' })
  })

  test('focusing the title link leaves the corrected target position alone', async () => {
    const value = document([section(simplePatch(), 'Focus target')])
    const fragment = reportTargets(value)[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const sectionTarget = doc.getElementById(fragment) as HTMLElement
    let scrolls = 0
    sectionTarget.scrollIntoView = () => { scrolls++ }
    const anchor = sectionTarget.querySelector<HTMLAnchorElement>('.section-title-text')!
    const focusOptions: (FocusOptions | undefined)[] = []
    const originalFocus = anchor.focus.bind(anchor)
    anchor.focus = (options?: FocusOptions) => {
      focusOptions.push(options)
      originalFocus(options)
    }

    runReportClient()
    await waitFor(() => scrolls === 1)

    expect(focusOptions).toEqual([{ preventScroll: true }])
    expect(doc.activeElement).toBe(anchor)
    anchor.focus()
    expect(scrolls).toBe(1)
  })

  test('waits for every initial render and honors a hashchange while mounting', async () => {
    const value = document([
      section(simplePatch('one', 'one!'), 'Delayed first'),
      section(simplePatch('two', 'two!'), 'Delayed second'),
    ])
    const targets = reportTargets(value)
    const firstFragment = targets[0]!.steps[0]!.fragment
    const secondFragment = targets[1]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, ''), {
      url: `https://reports.example/r/report-id#${firstFragment}`,
    })
    const doc = dom.document as unknown as Document
    for (const fold of doc.querySelectorAll<HTMLDetailsElement>('details')) fold.open = false
    const first = doc.getElementById(firstFragment) as HTMLElement
    const second = doc.getElementById(secondFragment) as HTMLElement
    let firstScrolls = 0
    let secondScrolls = 0
    first.scrollIntoView = () => {
      firstScrolls++
    }
    second.scrollIntoView = () => {
      secondScrolls++
    }
    const completions: (() => void)[] = []
    const frames: FrameRequestCallback[] = []
    const timers = new Map<number, () => void>()
    let nextTimer = 1
    const previousSetTimeout = globalThis.setTimeout
    const previousClearTimeout = globalThis.clearTimeout
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      expect(delay).toBe(10_000)
      const id = nextTimer++
      timers.set(id, callback)
      return id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id)
    }) as unknown as typeof clearTimeout
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }) as typeof requestAnimationFrame

    try {
      mountReport((options) => {
        const instance = {
          options,
          render({ containerWrapper }: { containerWrapper: HTMLElement }) {
            completions.push(() =>
              options.onPostRender?.(
                containerWrapper,
                instance as unknown as FileDiff,
                'mount',
              ),
            )
            return false
          },
          setOptions(next: typeof options) {
            instance.options = next
          },
        }
        return instance as unknown as FileDiff
      })

      expect(completions).toHaveLength(2)
      expect(timers.size).toBe(2)
      expect(first.closest<HTMLDetailsElement>('.section-fold')?.open).toBe(true)
      expect(first.closest('.step')?.querySelector<HTMLDetailsElement>('.file')?.open).toBe(true)
      expect(firstScrolls).toBe(0)
      expect(frames).toHaveLength(0)

      dom.window.location.hash = secondFragment
      dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'))
      expect(second.closest<HTMLDetailsElement>('.section-fold')?.open).toBe(true)
      expect(second.closest('.step')?.querySelector<HTMLDetailsElement>('.file')?.open).toBe(true)

      completions[0]!()
      await Promise.resolve()
      expect(timers.size).toBe(1)
      expect(frames).toHaveLength(0)
      completions[1]!()
      for (let turn = 0; turn < 4; turn++) await Promise.resolve()
      expect(timers.size).toBe(0)
      expect(frames).toHaveLength(1)
      expect(firstScrolls).toBe(0)
      expect(secondScrolls).toBe(0)

      frames[0]!(Date.now())
      expect(firstScrolls).toBe(0)
      expect(secondScrolls).toBe(1)
      expect(doc.activeElement).toBe(
        second.querySelector(`a[href="#${secondFragment}"]`),
      )
    } finally {
      globalThis.setTimeout = previousSetTimeout
      globalThis.clearTimeout = previousClearTimeout
      globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }
  })

  test('a never-callback renderer settles through the bounded deadline', async () => {
    const value = document([section(simplePatch(), 'Bounded render')])
    const fragment = reportTargets(value)[0]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, ''), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const target = doc.getElementById(fragment) as HTMLElement
    const timers = new Map<number, () => void>()
    const frames: FrameRequestCallback[] = []
    let nextTimer = 1
    let scrolled = false
    target.scrollIntoView = () => {
      scrolled = true
    }
    const previousSetTimeout = globalThis.setTimeout
    const previousClearTimeout = globalThis.clearTimeout
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      expect(delay).toBe(10_000)
      const id = nextTimer++
      timers.set(id, callback)
      return id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id)
    }) as unknown as typeof clearTimeout
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }) as typeof requestAnimationFrame

    try {
      mountReport((options) => {
        const instance = {
          options,
          render() {
            return false
          },
          setOptions(next: typeof options) {
            instance.options = next
          },
        }
        return instance as unknown as FileDiff
      })

      expect(target.closest<HTMLDetailsElement>('.section-fold')?.open).toBe(true)
      expect(timers.size).toBe(1)
      expect(frames).toHaveLength(0)
      expect(scrolled).toBe(false)

      const [timerId, expire] = [...timers.entries()][0]!
      timers.delete(timerId)
      expire()
      for (let turn = 0; turn < 4; turn++) await Promise.resolve()
      expect(timers.size).toBe(0)
      expect(frames).toHaveLength(1)
      expect(scrolled).toBe(false)

      frames[0]!(Date.now())
      expect(scrolled).toBe(true)
      expect(doc.activeElement).toBe(target.querySelector('.step-actions > a'))
    } finally {
      globalThis.setTimeout = previousSetTimeout
      globalThis.clearTimeout = previousClearTimeout
      globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }
  })

  test('finalizes hash navigation when there are no diff mounts', async () => {
    const value = document([{ title: 'Text only', steps: [{ text: 'No diff to mount.' }] }])
    const fragment = reportTargets(value)[0]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, clientBundle), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const target = doc.getElementById(fragment) as HTMLElement
    let scrolled = false
    target.scrollIntoView = () => {
      scrolled = true
    }

    runReportClient()
    await waitFor(() => scrolled)

    expect(doc.activeElement).toBe(target.querySelector('.step-actions > a'))
  })

  test('finalizes hash navigation when an initial renderer throws', async () => {
    const value = document([section(simplePatch(), 'Render failure')])
    const fragment = reportTargets(value)[0]!.steps[0]!.fragment
    const dom = loadReport(renderReport(value, ''), {
      url: `https://reports.example/r/report-id#${fragment}`,
    })
    const doc = dom.document as unknown as Document
    const target = doc.getElementById(fragment) as HTMLElement
    let scrolled = false
    target.scrollIntoView = () => {
      scrolled = true
    }

    mountReport(() => {
      throw new Error('renderer failed')
    })
    await waitFor(() => scrolled)

    expect(doc.querySelector('.diff-error')?.textContent).toContain('renderer failed')
    expect(doc.activeElement).toBe(target.querySelector('.step-actions > a'))
  })

  test('only the section fold button toggles, while title and step links remain native', async () => {
    const value = document([{
      title: 'Linked title',
      steps: [{ text: 'Target step.', diff: simplePatch(), changes: ['change-001'] }],
    }])
    const dom = loadReport(renderReport(value, clientBundle), {
      url: 'https://reports.example/r/report-id',
    })
    const doc = dom.document as unknown as Document
    runReportClient()
    const fold = doc.querySelector<HTMLDetailsElement>('.section-fold')!
    const summary = fold.querySelector<HTMLElement>('summary')!
    const button = summary.querySelector<HTMLButtonElement>('.section-toggle')!
    const title = summary.querySelector<HTMLAnchorElement>('.section-title-text')!
    const stepLink = fold.querySelector<HTMLAnchorElement>('.step-actions > a')!

    expect(summary.tabIndex).toBe(-1)
    expect(button.type).toBe('button')
    expect(button.tabIndex).toBe(0)
    expect(button.textContent).toContain('01')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(doc.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull()
    expect(title.tagName).toBe('A')
    expect(title.textContent).toBe('Linked title')
    expect(title.tabIndex).toBe(0)
    expect(stepLink.textContent).toBe('LINK')
    expect(stepLink.tabIndex).toBe(0)
    expect(doc.querySelector('[data-copy-fragment]')).toBeNull()
    expect(doc.querySelector('a[href="#change-001"]')).toBeNull()

    summary.click()
    expect(fold.open).toBe(true)
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    title.dispatchEvent(click as unknown as Event)
    expect(click.defaultPrevented).toBe(false)
    // happy-dom also applies summary activation to an interactive anchor;
    // navigation restores the fold when its native hashchange settles.
    await waitFor(() => fold.open)
    expect(fold.open).toBe(true)
    button.click()
    expect(fold.open).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    button.click()
    expect(fold.open).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    fold.open = false
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fold.open = true
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  test(
    'narrow viewport defaults split reports to unified but preserves explicit switching',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch('one', 'one!'), 'Narrow section'),
          section(simplePatch('two', 'two!'), 'Second narrow'),
        ]),
        clientBundle,
      )
      const dom = loadReport(html, { narrow: true })

      runReportClient()

      await waitFor(() => mountedCount(dom) === 2, 90000)
      const doc = dom.document as unknown as Document
      const unified = doc.querySelector<HTMLInputElement>('input[name="layout"][value="unified"]')
      const split = doc.querySelector<HTMLInputElement>('input[name="layout"][value="split"]')
      expect(unified?.checked).toBe(true)
      expect(split?.checked).toBe(false)
      await waitForQuiescent(dom)
      for (let index = 0; index < 2; index++) expect(codeColumns(dom, index)).toBe(1)

      submitLayout(dom, 'split')
      await waitForQuiescent(dom)
      for (let index = 0; index < 2; index++) expect(codeColumns(dom, index)).toBe(2)

      submitLayout(dom, 'unified')
      await waitForQuiescent(dom)
      for (let index = 0; index < 2; index++) expect(codeColumns(dom, index)).toBe(1)
    },
    120000,
  )

  test(
    'mounts every file diff and toggles unified/split on the same instances',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch('one', 'one!'), 'First section'),
          section([simplePatch('a', 'b'), simplePatch('c', 'd')].join(''), 'Second section'),
        ]),
        clientBundle,
      )
      const dom = loadReport(html)

      runReportClient()

      await waitFor(() => mountedCount(dom) === 3, 90000)
      const doc = dom.document as unknown as Document
      const wrappers = doc.querySelectorAll('.file-diff')
      expect(wrappers).toHaveLength(3)
      for (const wrapper of wrappers) {
        const container = wrapper.querySelector('diffs-container')
        expect(wrapper.shadowRoot).toBeNull()
        expect(container).not.toBeNull()
        expect(container!.shadowRoot).not.toBeNull()
      }
      await waitForQuiescent(dom)
      for (let index = 0; index < 3; index++) expect(codeColumns(dom, index)).toBe(2)

      const containersBefore = diffContainers(dom)
      expect(containersBefore).toHaveLength(3)

      submitLayout(dom, 'unified')
      await waitForQuiescent(dom)
      for (let index = 0; index < 3; index++) expect(codeColumns(dom, index)).toBe(1)
      expectSameContainers(containersBefore, diffContainers(dom))

      submitLayout(dom, 'split')
      await waitForQuiescent(dom)
      for (let index = 0; index < 3; index++) expect(codeColumns(dom, index)).toBe(2)
      expectSameContainers(containersBefore, diffContainers(dom))
    },
    120000,
  )

  test(
    'beforeprint reopens every closed details element',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch('one', 'one!'), 'First section'),
          section([simplePatch('a', 'b'), simplePatch('c', 'd')].join(''), 'Second section'),
        ]),
        clientBundle,
      )
      const dom = loadReport(html)
      runReportClient()

      await waitFor(() => mountedCount(dom) === 3, 90000)
      const doc = dom.document as unknown as Document
      const details = [...doc.querySelectorAll<HTMLDetailsElement>('details')]
      expect(details).toHaveLength(5)
      for (const detail of details) detail.open = false
      expect(details.every((detail) => !detail.open)).toBe(true)

      dom.window.dispatchEvent(new dom.window.Event('beforeprint'))
      for (const detail of details) expect(detail.open).toBe(true)
    },
    120000,
  )

  test(
    'narrow viewport keeps an explicitly unified report unified on initial mount',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch('one', 'one!'), 'Unified section'),
          section(simplePatch('two', 'two!'), 'Second unified'),
        ]),
        clientBundle,
        { layout: 'unified' },
      )
      const dom = loadReport(html, { narrow: true })
      runReportClient()

      await waitFor(() => mountedCount(dom) === 2, 90000)
      const doc = dom.document as unknown as Document
      const unified = doc.querySelector<HTMLInputElement>('input[name="layout"][value="unified"]')
      const split = doc.querySelector<HTMLInputElement>('input[name="layout"][value="split"]')
      expect(unified?.checked).toBe(true)
      expect(split?.checked).toBe(false)
      await waitForQuiescent(dom)
      for (let index = 0; index < 2; index++) expect(codeColumns(dom, index)).toBe(1)
    },
    120000,
  )

  test(
    'renders markdown and authored markup from the same step text',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch(), 'Rendered', {
            text: 'A **bold** point.\n\n<figure data-probe="yes"><svg viewBox="0 0 1 1"></svg></figure>',
          }),
        ]),
        clientBundle,
      )
      const dom = loadReport(html)

      runReportClient()

      await waitFor(() => mountedCount(dom) === 1)
      const doc = dom.document as unknown as Document
      expect(doc.querySelector('.step-text')?.innerHTML).toContain('<strong>bold</strong>')
      expect(doc.querySelector('.step-text [data-probe="yes"]')).not.toBeNull()
    },
    120000,
  )

  test(
    'a summary opens the page and renders its authored diagram as a live element',
    async () => {
      const html = renderReport(
        {
          ...document([section(simplePatch(), 'With a summary')]),
          summary: 'The shape of it.\n\n<figure data-summary="yes"><svg viewBox="0 0 1 1"></svg></figure>',
        },
        clientBundle,
      )
      const dom = loadReport(html)

      runReportClient()

      await waitFor(() => mountedCount(dom) === 1)
      const doc = dom.document as unknown as Document
      expect(doc.querySelector('.cover-summary [data-summary="yes"] svg')).not.toBeNull()
      expect(doc.querySelector('.cover-summary')?.textContent).toContain('The shape of it.')
    },
    120000,
  )

  test(
    'an unparseable step surfaces an inline error while others still mount',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch('ok', 'ok!'), 'Healthy section'),
          section(simplePatch(), 'Broken section'),
        ]),
        clientBundle,
      )
      const broken = html.replace(/"diff":"[^"]*"/, '"diff":"this is not a diff"')
      expect(broken).not.toBe(html)

      const dom = loadReport(broken)
      runReportClient()

      const doc = dom.document as unknown as Document
      await waitFor(() => doc.querySelector('.diff-error') != null)
      expect(doc.querySelector('.diff-error')?.textContent).toContain(
        'Could not render this step',
      )
      await waitFor(() => mountedCount(dom) === 1)
    },
    120000,
  )

  test(
    'one control folds and unfolds every section and individual folds still work',
    async () => {
      const value = document([
        section(simplePatch('one', 'one!'), 'First section'),
        section(simplePatch('two', 'two!'), 'Second section'),
      ])
      const dom = loadReport(renderReport(value, clientBundle), {
        url: 'https://reports.example/r/report-id',
      })
      const doc = dom.document as unknown as Document
      const dataScript = doc.querySelector<HTMLScriptElement>('#diffwalk-report-data')!
      const dataBefore = dataScript.textContent
      runReportClient()

      const button = doc.querySelector<HTMLButtonElement>('[data-fold-all]')!
      const folds = [...doc.querySelectorAll<HTMLDetailsElement>('details.section-fold')]
      const label = () => button.querySelector('[data-fold-all-label]')?.textContent
      const aria = () => button.getAttribute('aria-label')
      expect(folds).toHaveLength(2)
      expect(folds.every((fold) => fold.open)).toBe(true)
      expect(label()).toBe('Fold all')
      expect(aria()).toBe('Fold all review sections')

      button.click()
      expect(folds.every((fold) => !fold.open)).toBe(true)
      expect(label()).toBe('Unfold all')
      expect(aria()).toBe('Unfold all review sections')

      button.click()
      expect(folds.every((fold) => fold.open)).toBe(true)
      expect(label()).toBe('Fold all')
      expect(aria()).toBe('Fold all review sections')

      expect(dataScript.textContent).toBe(dataBefore)

      // Individual section buttons still fold and unfold after the global action,
      // and their toggle drives the global label.
      folds[0]!
        .querySelector('.section-toggle')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event)
      expect(folds[0]!.open).toBe(false)
      expect(folds[1]!.open).toBe(true)
      expect(label()).toBe('Fold all')

      folds[1]!
        .querySelector('.section-toggle')!
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event)
      expect(folds.every((fold) => !fold.open)).toBe(true)
      expect(label()).toBe('Unfold all')

      button.click()
      expect(folds.every((fold) => fold.open)).toBe(true)
      expect(label()).toBe('Fold all')
    },
    120000,
  )

  test(
    'folding all moves focus from a hidden child to the visible section row',
    async () => {
      const value = document([
        {
          title: 'First section',
          steps: [{ text: 'First.', diff: simplePatch('one', 'one!'), changes: ['change-001'] }],
        },
        {
          title: 'Second section',
          steps: [{ text: 'Second.', diff: simplePatch('two', 'two!'), changes: ['change-002'] }],
        },
      ])
      const dom = loadReport(renderReport(value, clientBundle), {
        url: 'https://reports.example/r/report-id',
      })
      const doc = dom.document as unknown as Document
      runReportClient()

      const firstSection = doc.querySelector<HTMLElement>('.section')!
      const focused = firstSection.querySelector<HTMLAnchorElement>(
        '.step-actions > a',
      )!
      focused.focus()
      expect(doc.activeElement).toBe(focused)

      // Real browsers blur a focused descendant the moment its ancestor details
      // closes; happy-dom keeps focus, so simulate that blur to prove the global
      // action still restores focus on the surviving section row.
      for (const fold of doc.querySelectorAll<HTMLDetailsElement>('details.section-fold')) {
        fold.addEventListener('toggle', () => {
          if (!fold.open && fold.contains(focused)) focused.blur()
        })
      }

      doc.querySelector<HTMLButtonElement>('[data-fold-all]')!.click()

      const folds = [...doc.querySelectorAll<HTMLDetailsElement>('details.section-fold')]
      expect(folds.every((fold) => !fold.open)).toBe(true)
      expect(firstSection.querySelector('details')?.open).toBe(false)
      const summary = firstSection.querySelector<HTMLElement>('.section-toggle')!
      expect(doc.activeElement).toBe(summary)
    },
    120000,
  )

  test(
    'folding all moves focus off a closed nested file row onto the section row',
    async () => {
      const value = document([
        section(simplePatch('one', 'one!'), 'First section'),
        section(simplePatch('two', 'two!'), 'Second section'),
      ])
      const dom = loadReport(renderReport(value, clientBundle), {
        url: 'https://reports.example/r/report-id',
      })
      const doc = dom.document as unknown as Document
      runReportClient()

      const firstSection = doc.querySelector<HTMLElement>('.section')!
      const file = firstSection.querySelector<HTMLDetailsElement>('details.file')!
      file.open = false
      const fileSummary = file.querySelector<HTMLElement>(':scope > summary')!
      fileSummary.focus()
      expect(doc.activeElement).toBe(fileSummary)

      for (const fold of doc.querySelectorAll<HTMLDetailsElement>('details.section-fold')) {
        fold.addEventListener('toggle', () => {
          if (!fold.open && fold.contains(fileSummary)) fileSummary.blur()
        })
      }

      doc.querySelector<HTMLButtonElement>('[data-fold-all]')!.click()

      const sectionSummary = firstSection.querySelector<HTMLElement>('.section-toggle')!
      expect(doc.activeElement).toBe(sectionSummary)
      expect(sectionSummary.closest('details')?.open).toBe(false)
    },
    120000,
  )

  test(
    'a visible focused section row stays focused and mixed states fold then unfold',
    async () => {
      const value = document([
        section(simplePatch('one', 'one!'), 'First section'),
        section(simplePatch('two', 'two!'), 'Second section'),
      ])
      const dom = loadReport(renderReport(value, clientBundle), {
        url: 'https://reports.example/r/report-id',
      })
      const doc = dom.document as unknown as Document
      runReportClient()

      const button = doc.querySelector<HTMLButtonElement>('[data-fold-all]')!
      const folds = [...doc.querySelectorAll<HTMLDetailsElement>('details.section-fold')]
      const label = () => button.querySelector('[data-fold-all-label]')?.textContent

      // A section summary is never hidden by its own fold, so focus must not move.
      const summary = folds[0]!.querySelector<HTMLElement>(':scope > summary')!
      summary.focus()
      button.click()
      expect(doc.activeElement).toBe(summary)

      // Mixed state: any open section means the global control folds all.
      folds[1]!.open = true
      expect(label()).toBe('Fold all')
      button.click()
      expect(folds.every((fold) => !fold.open)).toBe(true)
      expect(label()).toBe('Unfold all')

      button.click()
      expect(folds.every((fold) => fold.open)).toBe(true)
      expect(label()).toBe('Fold all')
    },
    120000,
  )
})
