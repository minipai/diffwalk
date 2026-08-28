/** @jsxImportSource @opentui/react */
import { describe, expect, test } from 'bun:test'
import { RGBA } from '@opentui/core'
import type { TestRendererSetup } from '@opentui/core/testing'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'
import { parseExplainSectionsJson, type ExplainSection } from '../src/document'
import { ExplainApp } from '../src/main'

const FOCUS = RGBA.fromHex('#2a5c8a')

function hunkDiff(path: string, oldLine: string, newLine: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    `-${oldLine}`,
    `+${newLine}`,
    '',
  ].join('\n')
}

function sectionDocument(...diffs: { title: string; body: string; diff: string }[]): string {
  return JSON.stringify({
    formatVersion: 1,
    source: { kind: 'proposed' },
    sections: diffs.map(({ title, body, diff }) => ({ explain: { title, body }, diff })),
  })
}

function twoSectionFixture(): ExplainSection[] {
  return parseExplainSectionsJson(
    sectionDocument(
      { title: 'First touch', body: 'Changes line one.', diff: hunkDiff('src/shared.ts', 'one', 'one!') },
      {
        title: 'Second touch',
        body: 'Changes two files.',
        diff: [hunkDiff('src/a.ts', 'a', 'b'), hunkDiff('src/b.ts', 'c', 'd')].join(''),
      },
    ),
  )
}

function manySectionFixture(count: number): ExplainSection[] {
  return parseExplainSectionsJson(
    sectionDocument(
      ...Array.from({ length: count }, (_, index) => ({
        title: `Explanation ${index}`,
        body: 'A body.',
        diff: hunkDiff(`src/file-${index}.ts`, `${index}`, `${index}!`),
      })),
    ),
  )
}

async function renderApp(
  sections: ExplainSection[],
  onQuit = () => {},
): Promise<TestRendererSetup> {
  const setup = await testRender(<ExplainApp sections={sections} onQuit={onQuit} />, {
    width: 120,
    height: 40,
    useMouse: true,
  })
  await act(async () => {
    await setup.flush()
  })
  return setup
}

function focusedLineTexts(setup: TestRendererSetup): string[] {
  const frame = setup.captureSpans()
  const focused: string[] = []
  for (const line of frame.lines) {
    const text = line.spans
      .filter((span) => span.bg.equals(FOCUS))
      .map((span) => span.text)
      .join('')
    if (text.trim() !== '') focused.push(text.trim())
  }
  return focused
}

function frameContains(setup: TestRendererSetup, text: string): boolean {
  return setup.captureCharFrame().includes(text)
}

function rowOf(setup: TestRendererSetup, text: string): number {
  const frame = setup.captureSpans()
  const index = frame.lines.findIndex((line) => line.spans.map((s) => s.text).join('').includes(text))
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

async function press(setup: TestRendererSetup, key: string) {
  await act(async () => {
    await setup.mockInput.pressKeys([key])
  })
  await act(async () => {
    await setup.flush()
  })
}

async function click(setup: TestRendererSetup, x: number, y: number) {
  await act(async () => {
    await setup.mockMouse.click(x, y)
  })
  await act(async () => {
    await setup.flush()
  })
}

async function teardown(setup: TestRendererSetup) {
  await act(async () => {
    await setup.renderer.destroy()
  })
}

describe('reader keyboard navigation', () => {
  test('the first visible explanation is focused on load', async () => {
    const setup = await renderApp(twoSectionFixture())
    expect(focusedLineTexts(setup)).toEqual(['▾ First touch · 1 file'])
    await teardown(setup)
  })

  test('j and the down arrow step through every visible node', async () => {
    const setup = await renderApp(twoSectionFixture())

    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/shared.ts  +1 −1'])

    await press(setup, 'ARROW_DOWN')
    expect(focusedLineTexts(setup)).toEqual(['▾ Second touch · 2 files'])

    await press(setup, 'ARROW_DOWN')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/a.ts  +1 −1'])

    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/b.ts  +1 −1'])

    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/b.ts  +1 −1'])

    await press(setup, 'k')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/a.ts  +1 −1'])

    await press(setup, 'ARROW_UP')
    expect(focusedLineTexts(setup)).toEqual(['▾ Second touch · 2 files'])
    await teardown(setup)
  })

  test('enter folds the focused explanation and keeps focus on it', async () => {
    const setup = await renderApp(twoSectionFixture())

    await press(setup, 'j')
    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ Second touch · 2 files'])

    await press(setup, 'RETURN')
    expect(focusedLineTexts(setup)).toEqual(['▸ Second touch · 2 files'])
    expect(frameContains(setup, 'src/a.ts')).toBe(false)
    expect(frameContains(setup, 'src/b.ts')).toBe(false)
    expect(frameContains(setup, 'Changes two files.')).toBe(false)

    await press(setup, 'RETURN')
    expect(focusedLineTexts(setup)).toEqual(['▾ Second touch · 2 files'])
    expect(frameContains(setup, 'src/a.ts')).toBe(true)
    await teardown(setup)
  })

  test('space folds and unfolds the focused file row', async () => {
    const setup = await renderApp(twoSectionFixture())

    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/shared.ts  +1 −1'])
    expect(frameContains(setup, '1 - one')).toBe(true)

    await press(setup, ' ')
    expect(focusedLineTexts(setup)).toEqual(['▸ src/shared.ts  +1 −1'])
    expect(frameContains(setup, '1 - one')).toBe(false)

    await press(setup, ' ')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/shared.ts  +1 −1'])
    expect(frameContains(setup, '1 - one')).toBe(true)
    await teardown(setup)
  })

  test('the focused node stays inside the viewport while scrolling', async () => {
    const setup = await renderApp(manySectionFixture(12))
    const frame = () => setup.captureCharFrame()

    for (let step = 0; step < 12; step++) {
      await press(setup, 'j')
      const text = focusedLineTexts(setup)[0]
      expect(text).toBeDefined()
      expect(frame()).toContain(text!)
    }
    await teardown(setup)
  })

  test('folding a focused node that was scrolled out of view brings it back', async () => {
    const setup = await renderApp(manySectionFixture(12))

    for (let i = 0; i < 22; i++) await press(setup, 'j')
    expect(focusedLineTexts(setup)[0]).toBe('▾ Explanation 11 · 1 file')

    await act(async () => {
      await setup.mockMouse.scroll(60, 20, 'up')
    })
    await act(async () => {
      await setup.flush()
    })
    expect(frameContains(setup, 'Explanation 11')).toBe(false)

    await press(setup, 'RETURN')

    expect(focusedLineTexts(setup)[0]).toBe('▸ Explanation 11 · 1 file')
    expect(frameContains(setup, 'Explanation 11')).toBe(true)
    await teardown(setup)
  })

  test('q quits', async () => {
    let quitCalls = 0
    const setup = await renderApp(twoSectionFixture(), () => quitCalls++)
    await press(setup, 'q')
    expect(quitCalls).toBe(1)
    await teardown(setup)
  })

  test('escape quits after the escape-sequence timeout', async () => {
    let quitCalls = 0
    const setup = await renderApp(twoSectionFixture(), () => quitCalls++)
    await act(async () => {
      setup.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 60))
      await setup.flush()
    })
    expect(quitCalls).toBe(1)
    await teardown(setup)
  })

  test('1 and 2 switch the diff layout without disrupting navigation', async () => {
    const setup = await renderApp(twoSectionFixture())
    await press(setup, '2')
    await press(setup, 'j')
    await press(setup, '1')
    await press(setup, 'ARROW_DOWN')
    expect(focusedLineTexts(setup)).toEqual(['▾ Second touch · 2 files'])
    await teardown(setup)
  })
})

describe('reader mouse folding', () => {
  test('clicking a header folds it and moves focus there', async () => {
    const setup = await renderApp(twoSectionFixture())

    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/shared.ts  +1 −1'])

    await click(setup, 20, rowOf(setup, 'First touch'))

    expect(focusedLineTexts(setup)).toEqual(['▸ First touch · 1 file'])
    expect(frameContains(setup, 'Changes line one.')).toBe(false)
    await teardown(setup)
  })

  test('clicking a header while focus sits on one of its children keeps focus visible', async () => {
    const setup = await renderApp(twoSectionFixture())

    await press(setup, 'j')
    await press(setup, 'j')
    await press(setup, 'j')
    expect(focusedLineTexts(setup)).toEqual(['▾ src/a.ts  +1 −1'])

    await click(setup, 20, rowOf(setup, 'Second touch'))

    expect(focusedLineTexts(setup)).toEqual(['▸ Second touch · 2 files'])
    expect(frameContains(setup, 'src/a.ts')).toBe(false)
    expect(frameContains(setup, 'src/b.ts')).toBe(false)
    await teardown(setup)
  })
})