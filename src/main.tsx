/** @jsxImportSource @opentui/react */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createCliRenderer, type KeyEvent } from '@opentui/core'
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react'
import { HunkReviewStream, type HunkDiffLayout } from 'hunkdiff/opentui'
import { useState } from 'react'
import { parseExplainSectionsJson, type ExplainSection } from './document'

const colors = {
  background: '#08111f',
  panel: '#0e1b2e',
  panelActive: '#173251',
  border: '#284264',
  primary: '#eef4ff',
  accent: '#7fd1ff',
}

const displayWidth = (Bun as unknown as { stringWidth(text: string): number }).stringWidth

function ExplainApp({ sections, onQuit }: { sections: ExplainSection[]; onQuit: () => void }) {
  const terminal = useTerminalDimensions()
  const [sectionIndex, setSectionIndex] = useState(0)
  const [layout, setLayout] = useState<HunkDiffLayout>('split')
  const [foldedSectionIds, setFoldedSectionIds] = useState<ReadonlySet<string>>(() => new Set())
  const activeSection = sections[sectionIndex] ?? sections[0]!
  const codeFolded = foldedSectionIds.has(activeSection.id)
  const mainWidth = Math.max(34, terminal.width - 2)
  const contentHeight = Math.max(8, terminal.height - 3)
  const explanationLines = wrappedLineCount(activeSection.body, Math.max(1, mainWidth - 4))
  const explanationHeight = Math.min(
    Math.max(4, contentHeight - 5),
    Math.max(4, explanationLines + 3),
  )
  const diffHeight = codeFolded ? 3 : Math.max(6, contentHeight - explanationHeight - 1)

  const selectSection = (nextIndex: number) => {
    const length = sections.length
    setSectionIndex((nextIndex + length) % length)
  }

  const toggleCode = () => {
    setFoldedSectionIds((folded) => {
      const next = new Set(folded)
      if (next.has(activeSection.id)) next.delete(activeSection.id)
      else next.add(activeSection.id)
      return next
    })
  }

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'q' || key.name === 'escape') return onQuit()
    if (key.name === 'j' || key.name === 'down') return selectSection(sectionIndex + 1)
    if (key.name === 'k' || key.name === 'up') return selectSection(sectionIndex - 1)
    if (key.name === 'space') return toggleCode()
    if (key.name === '1') return setLayout('split')
    if (key.name === '2') return setLayout('stack')
  })

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.background,
      }}
    >
      <box
        style={{
          width: '100%',
          height: 1,
          paddingLeft: 1,
          backgroundColor: colors.panelActive,
        }}
      >
        <text fg={colors.primary}>
          {` Explain · ${sectionIndex + 1}/${sections.length} · j/k navigate · Space fold code · 1 split · 2 stack · q quit `}
        </text>
      </box>

      <box style={{ width: '100%', height: 1 }} />

      <box
        style={{
          width: '100%',
          height: contentHeight,
          flexDirection: 'column',
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <box
          style={{
            width: mainWidth,
            height: explanationHeight,
            flexDirection: 'column',
            border: true,
            borderColor: colors.border,
            backgroundColor: colors.panel,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <box style={{ width: '100%', height: 1 }}>
            <text fg={colors.accent}>{activeSection.title}</text>
          </box>
          <box style={{ width: '100%', flexGrow: 1 }}>
            <text fg={colors.primary}>{activeSection.body || 'No explanation body.'}</text>
          </box>
        </box>

        <box style={{ height: 1 }} />

        <box
          style={{
            width: mainWidth,
            height: diffHeight,
            flexDirection: 'column',
            border: true,
            borderColor: colors.border,
            backgroundColor: colors.panel,
          }}
        >
          <box
            style={{
              width: '100%',
              height: 1,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: codeFolded ? colors.panel : colors.panelActive,
            }}
            onMouseUp={toggleCode}
          >
            <text fg={colors.accent}>
              {`${codeFolded ? '▸' : '▾'} Code changes · ${activeSection.files.length} ${activeSection.files.length === 1 ? 'file' : 'files'}`}
            </text>
          </box>

          {!codeFolded && (
            <scrollbox
              key={`${activeSection.id}:${layout}`}
              width="100%"
              height="100%"
              scrollY
              viewportCulling
              focused={false}
            >
              <HunkReviewStream
                files={activeSection.files}
                layout={layout}
                width={Math.max(30, mainWidth - 2)}
                theme="github-dark-default"
                showFileSeparators
              />
            </scrollbox>
          )}
        </box>
      </box>
    </box>
  )
}

function wrappedLineCount(text: string, width: number) {
  if (text === '') return 1
  return text
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(displayWidth(line) / width)), 0)
}

export async function viewDocument(inputPath: string) {
  const json = await readFile(resolve(inputPath), 'utf8')
  const sections = parseExplainSectionsJson(json)
  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    useMouse: true,
    exitOnCtrlC: true,
    openConsoleOnError: true,
  })
  const root = createRoot(renderer)
  root.render(<ExplainApp sections={sections} onQuit={() => renderer.destroy()} />)
}
