/** @jsxImportSource @opentui/react */
import { createCliRenderer, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core'
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react'
import { HunkDiffBody, type HunkDiffLayout, type HunkDiffFile } from 'hunkdiff/opentui'
import { useEffect, useRef, useState } from 'react'
import { explainSectionsFromDocument, type ExplainSection, type ExplainStep } from './document'
import type { ExplainDocument } from './format'
import {
  createFoldState,
  cursorIndex,
  cursorOfRow,
  filePath,
  moveCursor,
  rowId,
  sectionFileCount,
  toggleRow,
  visibleTreeRows,
  type ReaderCursor,
  type ReaderTreeRow,
} from './reader'

const colors = {
  background: '#08111f',
  panel: '#0e1b2e',
  panelActive: '#173251',
  border: '#284264',
  primary: '#eef4ff',
  accent: '#7fd1ff',
  focus: '#2a5c8a',
}

export function ExplainApp({ sections, onQuit }: { sections: ExplainSection[]; onQuit: () => void }) {
  const terminal = useTerminalDimensions()
  const [foldState, setFoldState] = useState(createFoldState)
  const [layout, setLayout] = useState<HunkDiffLayout>('split')
  const [cursor, setCursor] = useState<ReaderCursor | null>(null)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const rows = visibleTreeRows(sections, foldState)
  const cursorRowIndex = cursorIndex(rows, cursor)
  const cursorRowId = cursorRowIndex === -1 ? null : rowId(rows[cursorRowIndex]!)
  const mainWidth = Math.max(34, terminal.width - 2)
  const contentHeight = Math.max(8, terminal.height - 2)

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'q' || key.name === 'escape') return onQuit()
    if (key.name === '1') return setLayout('split')
    if (key.name === '2') return setLayout('stack')
    if (rows.length === 0) return
    if (key.name === 'j' || key.name === 'down') {
      setCursor((current) => moveCursor(rows, current, 1))
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      setCursor((current) => moveCursor(rows, current, -1))
      return
    }
    if (key.name === 'return' || key.name === 'space') {
      const row = rows[cursorRowIndex]
      if (row) toggleRowAt(row)
    }
  })

  useEffect(() => {
    if (cursorRowId === null) return
    scrollRef.current?.scrollChildIntoView(cursorRowId)
  }, [cursorRowId, foldState])

  function toggleRowAt(row: ReaderTreeRow) {
    setFoldState((state) => toggleRow(state, row))
    setCursor(cursorOfRow(row))
  }

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
          {` Explain tree · j/k or ↑/↓ move · Enter/Space fold · click a header to fold · 1 split · 2 stack · q quit `}
        </text>
      </box>

      <box style={{ width: '100%', height: 1 }} />

      <scrollbox
        ref={scrollRef}
        width="100%"
        height={contentHeight}
        scrollY
        viewportCulling
        focused={false}
      >
        <box
          style={{
            width: mainWidth,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          {rows.map((row, index) => {
            if (row.kind === 'explain') {
              return (
                <ExplainNode
                  key={row.section.id}
                  id={rowId(row)}
                  section={row.section}
                  folded={row.folded}
                  selected={index === cursorRowIndex}
                  onToggle={() => toggleRowAt(row)}
                />
              )
            }
            if (row.kind === 'step') {
              return (
                <StepNode
                  key={row.step.id}
                  id={rowId(row)}
                  step={row.step}
                  folded={row.folded}
                  selected={index === cursorRowIndex}
                  onToggle={() => toggleRowAt(row)}
                />
              )
            }
            return (
              <FileNode
                key={row.file.id}
                id={rowId(row)}
                file={row.file}
                folded={row.folded}
                selected={index === cursorRowIndex}
                layout={layout}
                width={Math.max(8, mainWidth - 6)}
                onToggle={() => toggleRowAt(row)}
              />
            )
          })}
        </box>
      </scrollbox>
    </box>
  )
}

function ExplainNode({
  id,
  section,
  folded,
  selected,
  onToggle,
}: {
  id: string
  section: ExplainSection
  folded: boolean
  selected: boolean
  onToggle: () => void
}) {
  const fileCount = sectionFileCount(section)
  return (
    <box
      id={id}
      style={{
        width: '100%',
        height: 1,
        flexDirection: 'row',
        backgroundColor: selected ? colors.focus : folded ? colors.panel : colors.panelActive,
      }}
      onMouseUp={onToggle}
    >
      <text fg={colors.accent}>{`${folded ? '▸' : '▾'} `}</text>
      <text fg={selected ? colors.accent : colors.primary}>{section.title}</text>
      <text fg={colors.primary}>{` · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}</text>
    </box>
  )
}

function StepNode({
  id,
  step,
  folded,
  selected,
  onToggle,
}: {
  id: string
  step: ExplainStep
  folded: boolean
  selected: boolean
  onToggle: () => void
}) {
  // The first line is the row itself, the way a file path is; the rest unfolds beneath it,
  // so navigation stays one line per node.
  const [head = '', ...rest] = step.text.split('\n')
  const body = rest.join('\n').replace(/\s+$/, '')
  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box
        id={id}
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          backgroundColor: selected ? colors.focus : colors.background,
        }}
        onMouseUp={onToggle}
      >
        <text fg={colors.accent}>{`${folded ? '▸' : '▾'} `}</text>
        <text fg={selected ? colors.accent : colors.primary}>{head}</text>
      </box>
      {!folded && body !== '' && (
        <box
          style={{
            width: '100%',
            flexDirection: 'column',
            paddingLeft: 2,
            paddingRight: 2,
            paddingBottom: 1,
          }}
        >
          <box
            style={{
              width: '100%',
              flexDirection: 'column',
              border: true,
              borderColor: colors.border,
              backgroundColor: colors.panel,
              paddingLeft: 1,
              paddingRight: 1,
            }}
          >
            <text fg={colors.primary}>{body}</text>
          </box>
        </box>
      )}
    </box>
  )
}

function FileNode({
  id,
  file,
  folded,
  selected,
  layout,
  width,
  onToggle,
}: {
  id: string
  file: HunkDiffFile
  folded: boolean
  selected: boolean
  layout: HunkDiffLayout
  width: number
  onToggle: () => void
}) {
  const path = filePath(file)
  const previousPath = file.previousPath
  const label =
    previousPath && previousPath !== path ? `${previousPath} → ${path}` : path
  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        paddingLeft: 2,
        paddingRight: 2,
        paddingBottom: 1,
      }}
    >
      <box
        id={id}
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          backgroundColor: selected ? colors.focus : folded ? colors.panel : colors.panelActive,
        }}
        onMouseUp={onToggle}
      >
        <text fg={colors.accent}>{`${folded ? '▸' : '▾'} `}</text>
        <text fg={selected ? colors.accent : colors.primary}>{label}</text>
        <text fg={colors.primary}>{`  +${file.stats.additions} −${file.stats.deletions}`}</text>
      </box>
      {!folded && (
        <box style={{ width: '100%', flexDirection: 'column' }}>
          <HunkDiffBody file={file} layout={layout} width={width} theme="github-dark-default" />
        </box>
      )}
    </box>
  )
}

export async function viewDocument(document: ExplainDocument) {
  const sections = explainSectionsFromDocument(document)
  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    useMouse: true,
    exitOnCtrlC: true,
    openConsoleOnError: true,
  })
  const root = createRoot(renderer)
  root.render(<ExplainApp sections={sections} onQuit={() => renderer.destroy()} />)
}
