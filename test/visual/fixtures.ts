import type { ExplainDocument } from '../../src/format/types'

export function simplePatch(oldLine = 'old', newLine = 'new'): string {
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

export function pureRenamePatch(): string {
  return [
    'diff --git a/old-name.ts b/new-name.ts',
    'rename from old-name.ts',
    'rename to new-name.ts',
    '',
  ].join('\n')
}

export function reportDocument(): ExplainDocument {
  return {
    formatVersion: 1,
    title: 'Share reports by link',
    summary: 'The shape of it.\n\nA second paragraph keeps the cover measurable.',
    metadata: { explainedBy: 'Claude Code' },
    source: {
      kind: 'working-tree',
      capturedAt: '2026-08-28T00:00:00.000Z',
      from: { revision: 'HEAD', commit: '0123456789abcdef' },
    },
    sections: [
      {
        title: 'First section',
        steps: [{ text: 'A complete explanation on its own.', diff: simplePatch('one', 'one!') }],
      },
      {
        title: 'Renamed without changes in averylongunbrokenidentifierthatmustwrap',
        steps: [{ text: 'The rename keeps the previous content.', diff: pureRenamePatch() }],
      },
    ],
  }
}
