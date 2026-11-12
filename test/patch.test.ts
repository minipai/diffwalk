import { describe, expect, test } from 'bun:test'
import { applyPatch } from 'diff'
import {
  buildStepPatch,
  changeBlocksFromPatch,
  parseGitPatch,
  type PatchFileMetadata,
} from '../src/authoring/patch'
import type { TextChangeBlock } from '../src/format/types'

const modified: PatchFileMetadata = {
  path: 'example.ts',
  status: 'modified',
  oldMode: '100644',
  newMode: '100644',
}

function asChange(
  file: PatchFileMetadata,
  block: ReturnType<typeof changeBlocksFromPatch>[number],
  id = 'change-001',
): TextChangeBlock {
  return { kind: 'text', id, path: file.path, ...block }
}

function parseSingle(patch: string) {
  const [file] = parseGitPatch(patch)
  if (file === undefined) throw new Error('expected one parsed file')
  return file
}

describe('Git patch parsing', () => {
  test('derives line blocks with coordinates matching the files', () => {
    const parsed = parseSingle(
      [
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
        '',
      ].join('\n'),
    )

    expect(parsed.path).toBe('example.ts')
    expect(changeBlocksFromPatch(parsed)).toEqual([
      {
        oldStart: 2,
        oldCount: 1,
        newStart: 2,
        newCount: 1,
        before: 'two\n',
        after: 'TWO\n',
      },
    ])
  })

  test('keeps a missing final newline in the block content', () => {
    const parsed = parseSingle(
      [
        'diff --git a/example.ts b/example.ts',
        '--- a/example.ts',
        '+++ b/example.ts',
        '@@ -1,2 +1,2 @@',
        ' one',
        '-two',
        '\\ No newline at end of file',
        '+TWO',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    )

    expect(changeBlocksFromPatch(parsed)[0]).toMatchObject({
      before: 'two',
      after: 'TWO',
    })
  })

  test('unquotes tab, quote, and non-ASCII paths from Git headers', () => {
    for (const [oldHeader, newHeader, expected] of [
      [String.raw`"a/tab\tname.ts"`, String.raw`"b/tab\tname.ts"`, 'tab\tname.ts'],
      [String.raw`"a/quote\"name.ts"`, String.raw`"b/quote\"name.ts"`, 'quote"name.ts'],
      [String.raw`"a/\303\274n\303\257code.ts"`, String.raw`"b/\303\274n\303\257code.ts"`, 'ünïcode.ts'],
    ] as const) {
      const parsed = parseSingle(
        [
          `diff --git ${oldHeader} ${newHeader}`,
          `--- ${oldHeader}`,
          `+++ ${newHeader}`,
          '@@ -1 +1 @@',
          '-old',
          '+new',
          '',
        ].join('\n'),
      )
      expect(parsed.path).toBe(expected)
    }
  })
})

describe('selected-step patch construction', () => {
  const twoHunks = [
    'diff --git a/example.ts b/example.ts',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -10,3 +10,3 @@',
    ' ten',
    '-eleven',
    '+ELEVEN',
    ' twelve',
    '',
  ].join('\n')

  const oldContent =
    'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n'

  test('selects one block and keeps the other block as context', () => {
    const file = parseSingle(twoHunks)
    const changes = changeBlocksFromPatch(file)
    const built = buildStepPatch(modified, file, [asChange(modified, changes[0]!)])

    expect(built).toContain('-two')
    expect(built).toContain('+TWO')
    expect(built).not.toContain('-eleven')
    expect(built).not.toContain('+ELEVEN')
    expect(applyPatch(oldContent, built)).toBe(
      'one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n',
    )
  })

  test('materializes the later block first without depending on file snapshots', () => {
    const file = parseSingle(twoHunks)
    const changes = changeBlocksFromPatch(file)
    const built = buildStepPatch(modified, file, [asChange(modified, changes[1]!, 'change-002')])

    expect(built).toContain('-eleven')
    expect(built).toContain('+ELEVEN')
    expect(applyPatch(oldContent, built)).toBe(
      'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\nELEVEN\ntwelve\n',
    )
  })

  test('selects one of two nearby blocks in the same hunk', () => {
    const file = parseSingle(
      [
        'diff --git a/example.ts b/example.ts',
        '--- a/example.ts',
        '+++ b/example.ts',
        '@@ -1,7 +1,7 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
        ' four',
        '-five',
        '+FIVE',
        ' six',
        ' seven',
        '',
      ].join('\n'),
    )
    const changes = changeBlocksFromPatch(file)
    const built = buildStepPatch(modified, file, [asChange(modified, changes[0]!)])

    expect(built).toContain(' five')
    expect(built).not.toContain('-five')
    expect(built).not.toContain('+FIVE')
    expect(built).toContain('+TWO')
    expect(applyPatch('one\ntwo\nthree\nfour\nfive\nsix\nseven\n', built)).toBe(
      'one\nTWO\nthree\nfour\nfive\nsix\nseven\n',
    )
  })

  test('carries an earlier insertion or deletion into a later selected hunk', () => {
    const cases = [
      {
        first: [
          '@@ -1,3 +1,4 @@',
          ' one',
          ' two',
          '+inserted',
          ' three',
        ],
        header: '@@ -9,3 +10,3 @@',
        expected:
          'one\ntwo\ninserted\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\neleven\n',
      },
      {
        first: [
          '@@ -1,4 +1,3 @@',
          ' one',
          '-two',
          ' three',
          ' four',
        ],
        header: '@@ -9,3 +8,3 @@',
        expected: 'one\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\neleven\n',
      },
    ] as const

    for (const { first, header, expected } of cases) {
      const file = parseSingle(
        [
          'diff --git a/example.ts b/example.ts',
          '--- a/example.ts',
          '+++ b/example.ts',
          ...first,
          header,
          ' nine',
          '-ten',
          '+TEN',
          ' eleven',
          '',
        ].join('\n'),
      )
      const changes = changeBlocksFromPatch(file)
      const built = buildStepPatch(
        modified,
        file,
        changes.map((block, index) => asChange(modified, block, `change-00${index + 1}`)),
      )

      expect(built).toContain(header)
      const laterOnly = buildStepPatch(modified, file, [
        asChange(modified, changes[1]!, 'change-002'),
      ])
      expect(laterOnly).toContain('@@ -9,3 +9,3 @@')
      expect(
        applyPatch(
          'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n',
          laterOnly,
        ),
      ).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\neleven\n')
      expect(
        applyPatch(
          'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n',
          built,
        ),
      ).toBe(expected)
    }
  })

  test('preserves a missing final newline through selection', () => {
    const file = parseSingle(
      [
        'diff --git a/example.ts b/example.ts',
        '--- a/example.ts',
        '+++ b/example.ts',
        '@@ -1,2 +1,2 @@',
        ' one',
        '-two',
        '\\ No newline at end of file',
        '+TWO',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    )
    const changes = changeBlocksFromPatch(file)
    const built = buildStepPatch(modified, file, [asChange(modified, changes[0]!)])

    expect(built).toContain('\\ No newline at end of file')
    expect(applyPatch('one\ntwo', built)).toBe('one\nTWO')
  })

  test('keeps executable add and delete semantics', () => {
    const added = parseSingle(
      [
        'diff --git a/added.sh b/added.sh',
        'new file mode 100755',
        '--- /dev/null',
        '+++ b/added.sh',
        '@@ -0,0 +1,2 @@',
        '+#!/bin/sh',
        '+echo added',
        '',
      ].join('\n'),
    )
    const addedFile: PatchFileMetadata = {
      path: 'added.sh',
      status: 'added',
      oldMode: '000000',
      newMode: '100755',
    }
    const addedPatch = buildStepPatch(
      addedFile,
      added,
      changeBlocksFromPatch(added).map((block) => asChange(addedFile, block)),
    )

    expect(addedPatch).toContain('new file mode 100755')
    expect(addedPatch).toContain('@@ -0,0 +1,2 @@')
    expect(applyPatch('', addedPatch)).toBe('#!/bin/sh\necho added\n')

    const deleted = parseSingle(
      [
        'diff --git a/deleted.sh b/deleted.sh',
        'deleted file mode 100755',
        '--- a/deleted.sh',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-#!/bin/sh',
        '-echo deleted',
        '',
      ].join('\n'),
    )
    const deletedFile: PatchFileMetadata = {
      path: 'deleted.sh',
      status: 'deleted',
      oldMode: '100755',
      newMode: '000000',
    }
    const deletedPatch = buildStepPatch(
      deletedFile,
      deleted,
      changeBlocksFromPatch(deleted).map((block) => asChange(deletedFile, block)),
    )

    expect(deletedPatch).toContain('deleted file mode 100755')
    expect(deletedPatch).toContain('@@ -1,2 +0,0 @@')
    expect(applyPatch('#!/bin/sh\necho deleted\n', deletedPatch)).toBe('')
  })

  test('materializes a pure rename as rename metadata without a hunk', () => {
    const renamed = parseSingle(
      [
        'diff --git a/old-name.ts b/new-name.ts',
        'similarity index 100%',
        'rename from old-name.ts',
        'rename to new-name.ts',
        '',
      ].join('\n'),
    )
    const file: PatchFileMetadata = {
      path: 'new-name.ts',
      oldPath: 'old-name.ts',
      status: 'renamed',
      oldMode: '100644',
      newMode: '100755',
    }
    const built = buildStepPatch(file, renamed, [
      {
        kind: 'text',
        id: 'change-001',
        path: file.path,
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: 0,
        before: '',
        after: '',
      },
    ])

    expect(built).toContain('old mode 100644\nnew mode 100755')
    expect(built).toContain(
      'similarity index 100%\nrename from old-name.ts\nrename to new-name.ts',
    )
    expect(built).not.toContain('@@ ')
  })

  test('rejects a selected block that no longer matches the patch', () => {
    const file = parseSingle(twoHunks)
    const change = asChange(modified, changeBlocksFromPatch(file)[0]!)
    change.after = 'WRONG\n'

    expect(() => buildStepPatch(modified, file, [change])).toThrow(
      'no longer matches captured file content',
    )
  })
})
