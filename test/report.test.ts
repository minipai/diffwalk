import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExplainDocument } from '../src/format'
import { renderMarkdown } from '../src/report/markdown'
import { fileDiffStats, parseSectionPatch } from '../src/report/patches'
import { loadReportClient, renderReport, writeReport } from '../src/report'
import { reportTargets } from '../src/report/targets'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

function section(patch: string, title: string, options: { text?: string } = {}) {
  return {
    title,
    steps: [{ text: options.text ?? 'A complete explanation on its own.', diff: patch }],
  }
}

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

function renamePatch(changed = false): string {
  return [
    'diff --git a/old-name.ts b/new-name.ts',
    'rename from old-name.ts',
    'rename to new-name.ts',
    ...(changed
      ? ['--- a/old-name.ts', '+++ b/new-name.ts', '@@ -1 +1 @@', '-old', '+new']
      : []),
    '',
  ].join('\n')
}

function quotedRenamePatch(changed = false): string {
  return [
    String.raw`diff --git "a/old\t\\\"name.ts" "b/new\t\\\"name.ts"`,
    ...(changed ? [] : ['similarity index 100%']),
    String.raw`rename from "old\t\\\"name.ts"`,
    String.raw`rename to "new\t\\\"name.ts"`,
    ...(changed
      ? [
          String.raw`--- "a/old\t\\\"name.ts"`,
          String.raw`+++ "b/new\t\\\"name.ts"`,
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ]
      : []),
    '',
  ].join('\n')
}

function document(
  sections: ExplainDocument['sections'],
  options: { title?: string; summary?: string } = {},
): ExplainDocument {
  return {
    formatVersion: 1,
    title: options.title ?? 'A change set',
    summary: options.summary ?? '',
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections,
  }
}

const stubClient = '/* report client stub */'

describe('renderMarkdown', () => {
  // Authored text is trusted, so a diagram can be written inline. Containment is the
  // report origin's Content Security Policy, not escaping.
  test('inline html in the text passes through so a diagram can be authored', () => {
    const html = renderMarkdown('Before <svg viewBox="0 0 1 1"></svg> after <b>bold</b>.')

    expect(html).toContain('<svg viewBox="0 0 1 1"></svg>')
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('Before')
  })

  test('markdown structure still renders around inline html', () => {
    const html = renderMarkdown('## Heading\n\n- one\n- two\n\n`inline <x>`')

    expect(html).toContain('<h2>Heading</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>inline &lt;x&gt;</code>')
  })

  test('links with executable URL schemes are disabled', () => {
    const html = renderMarkdown(
      '[bad](javascript:alert(1)) [bad2](data:text/html,x) [ok](https://example.com) [mail](mailto:a@b.c) [rel](../next) [frag](#anchor)',
    )

    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="mailto:a@b.c"')
    expect(html).toContain('href="../next"')
    expect(html).toContain('href="#anchor"')
  })

  test('link hrefs cannot break out of the attribute', () => {
    const html = renderMarkdown('[x](#top"onclick="window.__pwned=1)')

    expect(html).not.toMatch(/" onclick=/)
    expect(html).toContain('href="#top&quot;onclick=&quot;')
  })

  // One rule covers both outputs: embed the image. A remote URL still renders here, but
  // the hosted report's img-src blocks it, so the local file and the link would differ.
  test('image sources are emitted as authored and escaped into the attribute', () => {
    const html = renderMarkdown(
      '![local](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=) ![odd](#a"onerror="x)',
    )

    expect(html).toContain('src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="')
    expect(html).toContain('alt="local"')
    expect(html).not.toMatch(/" onerror=/)
  })
})

describe('renderReport shell', () => {
  test('renders section steps and file folds in document order', () => {
    const html = renderReport(
      document([
        section(simplePatch('one', 'one!'), 'First section'),
        section(simplePatch('two', 'two!'), 'Second section'),
      ]),
      stubClient,
    )

    const first = html.indexOf('First section')
    const second = html.indexOf('Second section')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(html).toContain('data-section-index="0"')
    expect(html).toContain('data-section-index="1"')
    expect(html).toContain('data-diff-mount="0-0-0"')
    expect(html).toContain('data-diff-mount="1-0-0"')
    expect(html).not.toContain('id="section-0-step-0-file-0"')
    expect(html).toContain('+1 −1')
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,')
  })

  test('renders a legacy pure rename as a static row without an empty diff body', () => {
    const html = renderReport(document([section(renamePatch(), 'Rename')]), stubClient)

    expect(html).toContain('old-name.ts → new-name.ts')
    expect(html).toContain('Renamed · content unchanged')
    expect(html).not.toContain('+0 −0')
    expect(html).not.toContain('data-diff-mount="0-0-0"')
    expect(html).toContain('<div class="file file-static">')
    expect(html).not.toContain('<details class="file"')
  })

  test('renders changed renames with both paths, statistics, and a diff body', () => {
    const html = renderReport(document([section(renamePatch(true), 'Changed rename')]), stubClient)

    expect(html).toContain('old-name.ts → new-name.ts')
    expect(html).toContain('+1 −1')
    expect(html).not.toContain('Renamed · content unchanged')
    expect(html).toContain('data-diff-mount="0-0-0"')
  })

  test('steps interleave text and diffs in the order they were authored', () => {
    const html = renderReport(
      document([
        {
          title: 'Built in order',
          steps: [
            { text: 'Setup first.' },
            { text: 'Then the change.', diff: simplePatch('one', 'one!') },
            { text: 'Then the payoff.', diff: simplePatch('two', 'two!') },
          ],
        },
      ]),
      stubClient,
    )

    const setup = html.indexOf('Setup first.')
    const firstDiff = html.indexOf('data-diff-mount="0-1-0"')
    const payoff = html.indexOf('Then the payoff.')
    const secondDiff = html.indexOf('data-diff-mount="0-2-0"')

    expect(setup).toBeGreaterThan(-1)
    expect(firstDiff).toBeGreaterThan(setup)
    expect(payoff).toBeGreaterThan(firstDiff)
    expect(secondDiff).toBeGreaterThan(payoff)
    expect(html).toContain('data-step-index="0"')
  })

  test('a step without text renders its files and no empty prose block', () => {
    const html = renderReport(
      document([{ title: 'Diff only', steps: [{ text: '', diff: simplePatch() }] }]),
      stubClient,
    )

    expect(html).toContain('data-diff-mount="0-0-0"')
    expect(html).not.toContain('class="step-text prose"')
  })

  test('the document title becomes the heading and the page title', () => {
    const html = renderReport(
      document([section(simplePatch(), 'Plain')], { title: 'Share reports by link' }),
      stubClient,
    )

    expect(html).toContain('<title>Share reports by link</title>')
    expect(html).toContain('<h1>Share reports by link</h1>')
  })

  // Title, provenance, and summary are one opening, so they share one card, and the
  // card is the first thing inside <main>: the review map is a sticky column of that
  // grid, so anything stacked above the workspace pushes the map below the fold.
  test('the cover carries the title, the provenance, and the optional summary', () => {
    const withSummary = renderReport(
      document([section(simplePatch(), 'Plain')], {
        title: 'Share reports by link',
        summary: 'The shape of it.\n\n<svg viewBox="0 0 10 10"></svg>',
      }),
      stubClient,
    )
    const main = withSummary.indexOf('<main>')
    const cover = withSummary.indexOf('<section class="report-cover">')
    const heading = withSummary.indexOf('<h1>Share reports by link</h1>')
    const provenance = withSummary.indexOf('<dl class="source-metadata">')
    const summary = withSummary.indexOf('<div class="cover-summary prose">')
    const firstSection = withSummary.indexOf('data-section-index="0"')

    expect(main).toBeGreaterThan(-1)
    expect(cover).toBeGreaterThan(main)
    expect(heading).toBeGreaterThan(cover)
    expect(provenance).toBeGreaterThan(heading)
    expect(summary).toBeGreaterThan(provenance)
    expect(firstSection).toBeGreaterThan(summary)
    expect(withSummary).toContain('<svg viewBox="0 0 10 10"></svg>')

    const withoutSummary = renderReport(document([section(simplePatch(), 'Plain')]), stubClient)
    expect(withoutSummary).toContain('<section class="report-cover">')
    expect(withoutSummary).not.toContain('class="cover-summary')
  })

  test('there is no page header: the layout toggle opens the review map', () => {
    const html = renderReport(document([section(simplePatch(), 'Plain')]), stubClient)
    const map = html.indexOf('<nav class="review-map"')
    const form = html.indexOf('<form class="layout-form"')
    const label = html.indexOf('<p class="review-map-label">')

    expect(html).not.toContain('class="report-header"')
    expect(form).toBeGreaterThan(map)
    expect(label).toBeGreaterThan(form)
  })

  test('commit-diff source metadata shows From and To endpoints', () => {
    const html = renderReport(
      {
        formatVersion: 1,
        title: 'A change set',
        summary: '',
        source: {
          kind: 'commit-diff',
          capturedAt: '2026-08-28T00:00:00.000Z',
          from: { revision: 'main', commit: '0123456789abcdef' },
          to: { revision: 'feature', commit: 'fedcba9876543210' },
        },
        sections: [section(simplePatch(), 'Commit diff')],
      },
      stubClient,
    )

    expect(html).toContain('<dt>From</dt><dd>main <code>0123456789abcdef</code></dd>')
    expect(html).toContain('<dt>To</dt><dd>feature <code>fedcba9876543210</code></dd>')
    expect(html).toContain('<dt>Captured at</dt><dd>2026-08-28T00:00:00.000Z</dd>')
  })

  test('working-tree source metadata shows From and the working tree', () => {
    const html = renderReport(
      {
        formatVersion: 1,
        title: 'A change set',
        summary: '',
        source: {
          kind: 'working-tree',
          capturedAt: '2026-08-28T00:00:00.000Z',
          from: { revision: 'HEAD', commit: '0123456789abcdef' },
        },
        sections: [section(simplePatch(), 'Working tree')],
      },
      stubClient,
    )

    expect(html).toContain('<dt>From</dt><dd>HEAD <code>0123456789abcdef</code></dd>')
    expect(html).toContain('<dt>To</dt><dd>Working tree</dd>')
    expect(html).toContain('<dt>Captured at</dt><dd>2026-08-28T00:00:00.000Z</dd>')
  })

  test('proposal source metadata shows Source and Captured at', () => {
    const html = renderReport(
      {
        formatVersion: 1,
        title: 'A change set',
        summary: '',
        source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
        sections: [section(simplePatch(), 'Proposal')],
      },
      stubClient,
    )

    expect(html).toContain('<dt>Source</dt><dd>Proposal</dd>')
    expect(html).toContain('<dt>Captured at</dt><dd>2026-08-28T00:00:00.000Z</dd>')
  })

  test('source metadata compacts to one ellipsized line per row in the sticky header', () => {
    const html = renderReport(
      {
        formatVersion: 1,
        title: 'A change set',
        summary: '',
        source: {
          kind: 'working-tree',
          capturedAt: '2026-08-28T00:00:00.000Z',
          from: { revision: 'HEAD', commit: '0123456789abcdef' },
        },
        sections: [section(simplePatch(), 'Narrow')],
      },
      stubClient,
    )

    expect(html).toContain('grid-template-columns: max-content minmax(0, 1fr);')
    expect(html).toContain('.source-metadata dd { margin: 0; min-width: 0;')
    expect(html).toContain('text-overflow: ellipsis; white-space: nowrap;')
  })

  test('layout radio defaults to split without an apply step', () => {
    const html = renderReport(document([section(simplePatch(), 'Layout')]), stubClient)

    expect(html).toContain('value="split" checked')
    expect(html).not.toContain('value="unified" checked')
    expect(html).not.toContain('<button type="submit">Apply</button>')
    expect(html).toContain('<button type="submit" hidden aria-hidden="true" tabindex="-1"></button>')
  })

  test('unified layout is preselected when requested', () => {
    const html = renderReport(document([section(simplePatch(), 'Layout')]), stubClient, {
      layout: 'unified',
    })

    expect(html).toContain('value="unified" checked')
  })

  test('review map lists every section in document order with zero-padded anchors and counts', () => {
    const value = document([
      section(simplePatch('a', 'b'), 'First section'),
      section([simplePatch('c', 'd'), simplePatch('e', 'f')].join(''), 'Second section'),
    ])
    const html = renderReport(value, stubClient)
    const targets = reportTargets(value)

    const mapStart = html.indexOf('class="review-map"')
    const first = html.indexOf('First section', mapStart)
    const second = html.indexOf('Second section', mapStart)
    expect(mapStart).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(html).toContain(`href="#${targets[0]!.fragment}"`)
    expect(html).toContain(`href="#${targets[1]!.fragment}"`)
    expect(html).toContain('class="review-map-index">01<')
    expect(html).toContain('class="review-map-index">02<')
    expect(html).toContain(`id="${targets[0]!.fragment}"`)
    expect(html).toContain(`id="${targets[1]!.fragment}"`)
    expect(html).not.toContain('href="#section-0"')
    expect(html).toContain('>2 sections<')
    expect(html).toContain('>3 files<')
    expect(html).toContain(
      '.review-map-title { min-width: 0; white-space: normal; overflow-wrap: anywhere; }',
    )
  })

  test('review map counts use singular labels for a single section and file', () => {
    const html = renderReport(document([section(simplePatch(), 'Lonely')]), stubClient)

    expect(html).toContain('class="review-map-index">01<')
    expect(html).toContain('>1 section<')
    expect(html).toContain('>1 file<')
  })

  test('renders canonical copy actions without exposing renderer mounts as fragment IDs', () => {
    const value = document([
      {
        title: 'Linkable',
        steps: [
          {
            text: 'A linkable step.',
            diff: simplePatch(),
            changes: ['change-001'],
          },
        ],
      },
    ])
    const target = reportTargets(value)[0]!
    const html = renderReport(value, stubClient)

    expect(html).toContain(`id="${target.fragment}" data-section-index="0"`)
    expect(html).toContain(`id="${target.steps[0]!.fragment}" data-step-index="0"`)
    expect(html).toContain('id="change-001" data-target-kind="change"')
    expect(html).toContain('aria-label="Copy link to section Linkable"')
    expect(html).toContain('aria-label="Copy link to step 1 in Linkable"')
    expect(html).toContain('aria-label="Copy link to change change-001"')
    expect(html).toContain('data-diff-mount="0-0-0"')
    expect(html).not.toContain('id="section-0-step-0-file-0"')
  })

  // The rail has no room on a narrow screen, but the toggle is still needed while
  // scrolled into a diff, so the map collapses to a sticky strip that keeps it.
  test('the review map collapses to a strip that keeps the layout toggle on narrow screens', () => {
    const html = renderReport(document([section(simplePatch(), 'Responsive')]), stubClient)

    expect(html).toContain('@media (max-width: 900px)')
    expect(html).toContain('.review-workspace { display: block; min-height: 0; }')
    expect(html).toContain('.review-map-label, .review-map-list, .review-map-counts { display: none; }')
    expect(html).not.toContain('.review-map { display: none; }\n  main { padding: 14px')
    expect(html).toContain('@media (max-width: 520px)')
  })

  test('section titles wrap long unbroken words instead of clipping inside the fold', () => {
    const html = renderReport(document([section(simplePatch(), 'Wrap me')]), stubClient)

    expect(html).toContain('.section-fold > summary {')
    expect(html).toContain('overflow-wrap: anywhere;')
  })

  test('print output hides review map and layout controls and keeps source metadata', () => {
    const html = renderReport(document([section(simplePatch(), 'Print')]), stubClient)

    expect(html).toContain('@media print')
    expect(html).toContain('.layout-form, .copy-link { display: none; }')
    expect(html).toContain('.review-map { display: none; }')
    expect(html).toContain('.report-cover { box-shadow: none; break-inside: avoid; }')
    expect(html).toContain('.source-metadata dd { white-space: normal; overflow: visible; }')
  })
})

describe('embedded report data escaping', () => {
  test('a diff containing script terminators never breaks the embedded data script', () => {
    const html = renderReport(
      document([section(simplePatch('</script>', '<!--'), 'Tricky')]),
      stubClient,
    )

    expect(html.match(/<script/g)).toHaveLength(2)
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    const dataStart = html.indexOf('id="diffwalk-report-data">') + 'id="diffwalk-report-data">'.length
    const dataEnd = html.indexOf('</script>', dataStart)
    const embedded = html.slice(dataStart, dataEnd)

    const parsed = JSON.parse(embedded.replace(/\\u003c/g, '<')) as {
      diffs: { section: number; step: number; diff: string }[]
    }
    expect(parsed.diffs).toHaveLength(1)
    expect(parsed.diffs[0]).toMatchObject({ section: 0, step: 0 })
    expect(parsed.diffs[0]!.diff).toContain('</script>')
  })

  test('script terminators inside the bundled client are neutralised', () => {
    const bundle = 'const probe = "</script><!--";'
    const html = renderReport(document([section(simplePatch(), 'Bundle')]), bundle)

    expect(html).not.toContain('"</script>"')
    expect(html).toContain('"<\\/script><\\x2d\\x2d"')
    expect(html.match(/<\/script>/g)).toHaveLength(2)
  })
})

describe('trusted text boundary', () => {
  test('authored markup inside step text is inserted verbatim', () => {
    const html = renderReport(
      document([
        section(simplePatch(), 'Authored', {
          text: '<figure><svg viewBox="0 0 1 1"><text></text></svg></figure>',
        }),
      ]),
      stubClient,
    )

    expect(html).toContain('<figure><svg viewBox="0 0 1 1"><text></text></svg></figure>')
  })
})

describe('report diff parsing failures', () => {
  test('an unparseable section diff is reported with its title', () => {
    expect(() =>
      renderReport(
        document([section('this is not a diff', 'Broken section')]),
        stubClient,
      ),
    ).toThrow('Section "Broken section" has an unparseable diff')
  })

  test('parseSectionPatch surfaces Pierre failures and empty results', () => {
    expect(() => parseSectionPatch('plain prose')).toThrow('no parseable file diffs')
    expect(() => parseSectionPatch('')).toThrow('no parseable file diffs')
  })
})

describe('unified and split share one parsed model', () => {
  test('normalizes both C-quoted rename paths for pure and changed renames', () => {
    for (const changed of [false, true]) {
      const [file] = parseSectionPatch(quotedRenamePatch(changed))

      expect(file).toMatchObject({
        name: 'new\t\\"name.ts',
        prevName: 'old\t\\"name.ts',
        type: changed ? 'rename-changed' : 'rename-pure',
      })
      expect(fileDiffStats(file!)).toEqual({
        additions: changed ? 1 : 0,
        deletions: changed ? 1 : 0,
      })
    }
  })

  test('recognizes a legacy pure rename within a mixed patch', () => {
    const files = parseSectionPatch(`${simplePatch()}${renamePatch()}`)

    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ name: 'example.ts', type: 'change' })
    expect(files[1]).toMatchObject({
      name: 'new-name.ts',
      prevName: 'old-name.ts',
      type: 'rename-pure',
      hunks: [],
    })
  })

  test('a single parse provides coherent coordinates for both layouts', () => {
    const patch = [
      'diff --git a/example.ts b/example.ts',
      '--- a/example.ts',
      '+++ b/example.ts',
      '@@ -1,5 +1,5 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      ' four',
      ' five',
    ].join('\n')

    const [file] = parseSectionPatch(patch)
    const hunk = file.hunks[0]!

    expect(file.name).toBe('example.ts')
    expect(hunk.additionLines).toBe(1)
    expect(hunk.deletionLines).toBe(1)
    expect(hunk.unifiedLineCount).toBe(6)
    expect(hunk.splitLineCount).toBe(5)
    expect(hunk.unifiedLineStart).toBe(0)
    expect(hunk.splitLineStart).toBe(0)
    expect(file.unifiedLineCount).toBe(hunk.unifiedLineCount)
    expect(file.splitLineCount).toBe(hunk.splitLineCount)

    const stats = fileDiffStats(file)
    expect(stats).toEqual({ additions: 1, deletions: 1 })
  })

  test('statistics and coordinates derive from the same hunks across files', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      '-a',
      '+b',
      ' c',
      '',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1,2 @@',
      ' d',
      '+e',
    ].join('\n')

    const files = parseSectionPatch(patch)
    expect(files.map((file) => file.name)).toEqual(['a.ts', 'b.ts'])
    const [first, second] = files
    expect(fileDiffStats(first!)).toEqual({ additions: 1, deletions: 1 })
    expect(fileDiffStats(second!)).toEqual({ additions: 1, deletions: 0 })
    for (const file of files) {
      const perHunk = file.hunks.reduce(
        (sum, hunk) => ({
          additions: sum.additions + hunk.additionLines,
          deletions: sum.deletions + hunk.deletionLines,
        }),
        { additions: 0, deletions: 0 },
      )
      expect(fileDiffStats(file)).toEqual(perHunk)
    }
  })
})

describe('bundled report client', () => {
  test('the generated report embeds one self-contained bundle with no network references', async () => {
    const bundle = await loadReportClient()
    const html = renderReport(document([section(simplePatch(), 'Embedded')]), bundle)

    expect(html.length).toBeGreaterThan(bundle.length)
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect([...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1])).toEqual([
      expect.stringContaining('data:image/svg+xml,'),
    ])
    expect(html).not.toMatch(/<img[^>]+src=/)
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//)
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    expect(bundle).not.toMatch(/import\s*\(\s*["']/)
    expect(bundle).not.toMatch(/new\s+Worker\s*\(/)
  })
})

describe('writeReport', () => {
  test('writes atomically, creates directories, and replaces existing files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-report-'))
    directories.push(directory)
    const output = join(directory, 'nested', 'report.html')

    await writeReport(output, 'first report')
    expect(await readFile(output, 'utf8')).toBe('first report')

    await writeReport(output, 'second report')
    expect(await readFile(output, 'utf8')).toBe('second report')

    expect(await readdir(join(directory, 'nested'))).toEqual(['report.html'])
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('a failed rename removes the temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diffwalk-report-'))
    directories.push(directory)
    await mkdir(join(directory, 'occupied'))

    await expect(writeReport(join(directory, 'occupied'), 'content')).rejects.toThrow()

    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
