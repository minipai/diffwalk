/** @jsxImportSource @opentui/react */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createCliRenderer, type KeyEvent } from '@opentui/core'
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react'
import { HunkDiffBody, type HunkDiffLayout, type HunkDiffFile } from 'hunkdiff/opentui'
import { useState } from 'react'
import { parseExplainSectionsJson, type ExplainSection } from './document'
import {
  createFoldState,
  filePath,
  toggleExplanation,
  toggleFile,
  visibleTreeRows,
} from './reader'

const colors = {
  background: '#08111f',
  panel: '#0e1b2e',
  panelActive: '#173251',
  border: '#284264',
  primary: '#eef4ff',
  accent: '#7fd1ff',
}

function ExplainApp({ sections, onQuit }: { sections: ExplainSection[]; onQuit: () => void }) {
  const terminal = useTerminalDimensions()
  const [foldState, setFoldState] = useState(createFoldState)
  const [layout, setLayout] = useState<HunkDiffLayout>('split')
  const rows = visibleTreeRows(sections, foldState)
  const mainWidth = Math.max(34, terminal.width - 2)
  const contentHeight = Math.max(8, terminal.height - 2)

  useKeyboard((key: KeyEvent) => {
    if (key.name === 'q' || key.name === 'escape') return onQuit()
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
          {` Explain tree · click a header to fold or unfold · 1 split · 2 stack · q quit `}
        </text>
      </box>

      <box style={{ width: '100%', height: 1 }} />

      <scrollbox width="100%" height={contentHeight} scrollY viewportCulling focused={false}>
        <box
          style={{
            width: mainWidth,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          {rows.map((row) =>
            row.kind === 'explain' ? (
              <ExplainNode
                key={row.section.id}
                section={row.section}
                folded={row.folded}
                onToggle={() => setFoldState((state) => toggleExplanation(state, row.section.id))}
              />
            ) : (
              <FileNode
                key={row.file.id}
                file={row.file}
                folded={row.folded}
                layout={layout}
                width={Math.max(8, mainWidth - 6)}
                onToggle={() =>
                  setFoldState((state) => toggleFile(state, row.sectionId, filePath(row.file)))
                }
              />
            ),
          )}
        </box>
      </scrollbox>
    </box>
  )
}

function ExplainNode({
  section,
  folded,
  onToggle,
}: {
  section: ExplainSection
  folded: boolean
  onToggle: () => void
}) {
  const fileCount = section.files.length
  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          backgroundColor: folded ? colors.panel : colors.panelActive,
        }}
        onMouseUp={onToggle}
      >
        <text fg={colors.accent}>{`${folded ? '▸' : '▾'} `}</text>
        <text fg={colors.primary}>{section.title}</text>
        <text fg={colors.primary}>{` · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}</text>
      </box>
      {!folded && (
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
            <text fg={colors.primary}>{section.body || 'No explanation body.'}</text>
          </box>
        </box>
      )}
    </box>
  )
}

function FileNode({
  file,
  folded,
  layout,
  width,
  onToggle,
}: {
  file: HunkDiffFile
  folded: boolean
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
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          backgroundColor: folded ? colors.panel : colors.panelActive,
        }}
        onMouseUp={onToggle}
      >
        <text fg={colors.accent}>{`${folded ? '▸' : '▾'} `}</text>
        <text fg={colors.primary}>{label}</text>
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
