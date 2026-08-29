# Architecture

Diffwalk is a standalone TUI for reading code changes as an ordered sequence of
explanations and their exact corresponding diffs.

## Product decisions

- The final read model is ordered `sections`, where every item is
  `{ explain: { title, body, html? }, diff }`.
- The final document `source` is one of: `commit-diff` (a `from`/`to` commit endpoint
  pair), `working-tree` (a `from` commit endpoint against the working tree), or
  `proposal` (no endpoints), each with an ISO `capturedAt`. A commit endpoint is a
  required `{ revision, commit }` pair. The authoring draft always carries the
  `working-tree` shape because inspect captures a Git base against the working tree.
- The report surface renders `body` as Markdown with raw HTML escaped, then inserts the
  optional trusted `html` fragment after it. The TUI reads only `body`.
- Authoring uses a separate draft containing captured full file contents,
  temporary `change-*` IDs, and `{ explain, changes[] }` sections.
- Temporary change IDs never appear in the final document.
- Every captured change ID must be assigned exactly once. Build rejects unknown,
  duplicate, and unassigned IDs.
- The agent should not hand-write unified patches for real working-tree changes.
  Pierre identifies `ChangeContent` blocks from complete old/new files; selected
  blocks are applied to the old content, then `diff` v9 creates a legal Git patch.
- Blocks can be explained separately even when Pierre renders them inside the
  same visual hunk.
- The reader shows every explanation in document order as one vertically
  scrollable tree. `j`/`↓` and `k`/`↑` move a cursor across the visible
  explanation and file headers, `Enter`/`Space` folds or unfolds the focused
  header, and the focused header is scrolled back into view when the cursor
  moves. Clicking an explanation header folds its body and file diffs; clicking
  a file header folds just that file's diff. Fold state is remembered
  independently per explanation and per file, keyed per section so the same
  path in different explanations folds separately. When a fold hides the
  focused node, the cursor moves to the nearest visible ancestor so it never
  rests on a hidden child. `1`/`2` select split/stack layout and `q`/`Escape`
  quits.

- The HTML report is generated from a version 1 document by `diffwalk report`.
  Diffwalk owns the shell: source metadata, section ordering, Markdown bodies,
  optional trusted `html` fragments, native section/file folds, unified/split
  selection, responsive and print styles. `@pierre/diffs` owns diff parsing,
  the diff Shadow DOM, styles, syntax highlighting, and layout changes through
  `setOptions({ diffStyle })`; the client parses each section patch once and
  mounts one `FileDiff` per file, so both layouts read the same parsed
  metadata. The report is written atomically (temp file plus rename). The
  client runtime is bundled once at build time into `dist/report-client.js`
  and inlined into the report, so the file has no CDN or external assets.

- Embedded report data is a `text/json` script with every `<` escaped as
  `\u003c`, and the inlined client has `</script` and `<!--` neutralised, so
  document content or authored fragments can never terminate the embedded
  scripts.

## Source map

- `src/format.ts`: Zod schemas for the authoring draft and final document.
- `src/git.ts`: captures staged, unstaged, deleted, renamed, and untracked UTF-8
  files from an immutable Git base commit.
- `src/authoring.ts`: creates change blocks, validates assignments, and materializes
  section patches.
- `src/cli.ts`: executable entry point for `inspect`, `build`, `report`, and `view`.
- `src/cli-args.ts`: command-specific argument parsing for the report command.
- `src/document.ts`: converts document patches into Hunk files.
- `src/reader.ts`: pure fold-state, visible-tree, and cursor logic for the reader.
- `src/main.tsx`: OpenTUI/React reader using Hunk's exported primitives.
- `src/report-patches.ts`: shared Pierre parse seam used by the generator, the browser
  client, and tests.
- `src/report-markdown.ts`: Markdown rendering with raw HTML escaped.
- `src/report.ts`: report shell generation, embedded-data escaping, atomic report writes,
  and client-bundle loading.
- `src/report-client.ts`: browser entry that mounts a `FileDiff` per file and switches
  unified/split through `setOptions`.
- `test/*.test.ts`: focused tests for authoring, Git capture, document input, reader
  folding, report schemas, Markdown escaping, embedded-data escaping, Pierre parse
  failures, report CLI parsing, and atomic writes.
- `test/reader-ui.test.tsx`: end-to-end reader tests through a rendered OpenTUI/React app
  for keyboard navigation, folding, focus, scrolling, mouse folding, and quitting.
- `.agents/skills/diffwalk/SKILL.md`: teaches agents the authoring workflow and invariants.
