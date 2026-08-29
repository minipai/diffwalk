import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExplainDocument } from '../src/format'
import { renderMarkdown } from '../src/report-markdown'
import { fileDiffStats, parseSectionPatch } from '../src/report-patches'
import { loadReportClient, renderReport, writeReport } from '../src/report'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

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

function document(sections: ExplainDocument['sections']): ExplainDocument {
  return {
    formatVersion: 1,
    source: { kind: 'proposal', capturedAt: '2026-08-28T00:00:00.000Z' },
    sections,
  }
}

const stubClient = '/* report client stub */'

describe('renderMarkdown', () => {
  test('raw html in the body is escaped, not executed', () => {
    const html = renderMarkdown('Before <script>alert(1)</script> after <b>bold</b>.')

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('Before')
  })

  test('markdown structure still renders around escaped html', () => {
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

  test('remote images are disabled while inline data images survive', () => {
    const html = renderMarkdown(
      '![remote](https://tracker.example/pixel.png) ![local](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
    )

    expect(html).not.toMatch(/src="https?:\/\//)
    expect(html).not.toContain('<img src="https://')
    expect(html).toContain('src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="')
    expect(html).toContain('alt="local"')
    expect(html).toContain('>remote <img')
  })
})

describe('renderReport shell', () => {
  test('renders section bodies and file folds in document order', () => {
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
    expect(html).toContain('section-0-file-0')
    expect(html).toContain('section-1-file-0')
    expect(html).toContain('+1 −1')
  })

  test('inserts the trusted html fragment after the markdown body', () => {
    const html = renderReport(
      document([
        section(simplePatch(), 'With a card', {
          body: 'Body text.',
          html: '<figure><svg viewBox="0 0 10 10" role="img"><rect width="10" height="10"/></svg></figure>',
        }),
      ]),
      stubClient,
    )

    const body = html.indexOf('>Body text.</p>')
    const fragment = html.indexOf('<figure><svg viewBox="0 0 10 10"')
    expect(body).toBeGreaterThan(-1)
    expect(fragment).toBeGreaterThan(body)
    expect(html).toContain('class="section-fragment"')
  })

  test('a section without html omits the fragment container', () => {
    const html = renderReport(document([section(simplePatch(), 'Plain')]), stubClient)

    expect(html).not.toContain('class="section-fragment"')
  })

  test('commit-diff source metadata shows From and To endpoints', () => {
    const html = renderReport(
      {
        formatVersion: 1,
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
    const html = renderReport(
      document([
        section(simplePatch('a', 'b'), 'First section'),
        section([simplePatch('c', 'd'), simplePatch('e', 'f')].join(''), 'Second section'),
      ]),
      stubClient,
    )

    const mapStart = html.indexOf('class="review-map"')
    const first = html.indexOf('First section', mapStart)
    const second = html.indexOf('Second section', mapStart)
    expect(mapStart).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(html).toContain('href="#section-0"')
    expect(html).toContain('href="#section-1"')
    expect(html).toContain('class="review-map-index">01<')
    expect(html).toContain('class="review-map-index">02<')
    expect(html).toContain('id="section-0"')
    expect(html).toContain('id="section-1"')
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

  test('responsive shell hides review map and metadata and compacts the header on narrow screens', () => {
    const html = renderReport(document([section(simplePatch(), 'Responsive')]), stubClient)

    expect(html).toContain('@media (max-width: 900px)')
    expect(html).toContain('.review-map { display: none; }')
    expect(html).toContain('.source-metadata { display: none; }')
    expect(html).toContain('.review-workspace { display: block; }')
    expect(html).toContain('grid-template-columns: 1fr auto')
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
    expect(html).toContain('.layout-form { display: none; }')
    expect(html).toContain('.review-map { display: none; }')
    expect(html).toContain('.report-header { position: static;')
    expect(html).toContain('.source-metadata { display: grid; }')
    expect(html).toContain('grid-template-columns: 1fr; gap: 4px 22px;')
    expect(html).toContain('.source-metadata dd { white-space: normal; overflow: visible; }')
  })
})

describe('embedded report data escaping', () => {
  test('a body or diff containing script terminators never breaks the embedded data script', () => {
    const html = renderReport(
      document([
        section(simplePatch(), 'Tricky', {
          body: '</script><script>alert(1)</script>',
        }),
      ]),
      stubClient,
    )

    expect(html.match(/<script/g)).toHaveLength(2)
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    const dataStart = html.indexOf('id="diffwalk-report-data">') + 'id="diffwalk-report-data">'.length
    const dataEnd = html.indexOf('</script>', dataStart)
    const embedded = html.slice(dataStart, dataEnd)

    const parsed = JSON.parse(embedded.replace(/\\u003c/g, '<')) as {
      sections: { diff: string; fileCount: number }[]
    }
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0]!.fileCount).toBe(1)
    expect(parsed.sections[0]!.diff).toContain('old')
  })

  test('script terminators inside the bundled client are neutralised', () => {
    const bundle = 'const probe = "</script><!--";'
    const html = renderReport(document([section(simplePatch(), 'Bundle')]), bundle)

    expect(html).not.toContain('"</script>"')
    expect(html).toContain('"<\\/script><\\x2d\\x2d"')
    expect(html.match(/<\/script>/g)).toHaveLength(2)
  })
})

describe('trusted fragment boundary', () => {
  test('the fragment is inserted verbatim as authored markup', () => {
    const html = renderReport(
      document([
        section(simplePatch(), 'Authored', {
          html: '<figure><svg viewBox="0 0 1 1"><text></text></svg></figure>',
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
    expect(html).not.toMatch(/<link[^>]+href=/)
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
