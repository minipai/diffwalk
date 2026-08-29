import { afterEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { ExplainDocument } from '../src/format'
import { loadReportClient, renderReport } from '../src/report'

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

function section(patch: string, title: string, options: { body?: string; html?: string } = {}) {
  return {
    explain: {
      title,
      body: options.body ?? 'A complete explanation on its own.',
      ...(options.html !== undefined ? { html: options.html } : {}),
    },
    diff: patch,
  }
}

function document(sections: ExplainDocument['sections']): ExplainDocument {
  return {
    formatVersion: 1,
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections,
  }
}

function shellWithoutClient(html: string): string {
  const clientStart = html.lastIndexOf('<script>')
  const clientEnd = html.lastIndexOf('</script>')
  return html.slice(0, clientStart) + html.slice(clientEnd + '</script>'.length)
}

function loadReport(html: string, options: { narrow?: boolean } = {}): Window {
  const dom = new Window({ url: 'file:///tmp/diffwalk-report.html' })
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
  test('review map anchors resolve to section ids in document order with counts', () => {
    const html = renderReport(
      document([
        section(simplePatch('a', 'b'), 'First section'),
        section([simplePatch('c', 'd'), simplePatch('e', 'f')].join(''), 'Second section'),
      ]),
      clientBundle,
    )
    const dom = loadReport(html)
    const doc = dom.document as unknown as Document

    const links = doc.querySelectorAll('.review-map a')
    expect(links).toHaveLength(2)
    expect([...links].map((link) => link.getAttribute('href'))).toEqual([
      '#section-0',
      '#section-1',
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
    'renders the markdown body and inserts the trusted fragment',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch(), 'Rendered', {
            body: 'A **bold** point.',
            html: '<figure data-probe="yes"><svg viewBox="0 0 1 1"></svg></figure>',
          }),
        ]),
        clientBundle,
      )
      const dom = loadReport(html)

      runReportClient()

      await waitFor(() => mountedCount(dom) === 1)
      const doc = dom.document as unknown as Document
      expect(doc.querySelector('.section-body')?.innerHTML).toContain('<strong>bold</strong>')
      expect(doc.querySelector('.section-fragment [data-probe="yes"]')).not.toBeNull()
    },
    120000,
  )

  test(
    'raw html in the body is escaped into text, never a live element',
    async () => {
      const html = renderReport(
        document([
          section(simplePatch(), 'Safe body', {
            body: '<img src=x onerror="window.__reportPwned = 1">',
            html: '<div data-frag="yes"></div>',
          }),
        ]),
        clientBundle,
      )
      const dom = loadReport(html)

      runReportClient()

      await waitFor(() => mountedCount(dom) === 1)
      const doc = dom.document as unknown as Document
      expect(
        (dom.window as unknown as Record<string, unknown>).__reportPwned,
      ).toBeUndefined()
      expect(doc.querySelector('.section-body img')).toBeNull()
      expect(doc.querySelector('.section-body script')).toBeNull()
      expect(doc.querySelector('.section-body')?.textContent).toContain('<img src=x onerror=')
      expect(doc.querySelector('.section-fragment [data-frag="yes"]')).not.toBeNull()
    },
    120000,
  )

  test(
    'an unparseable section surfaces an inline error while others still mount',
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
        'Could not render this section',
      )
      await waitFor(() => mountedCount(dom) === 1)
    },
    120000,
  )
})
