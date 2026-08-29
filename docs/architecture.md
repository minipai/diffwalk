# Architecture

Diffwalk is a standalone TUI for reading code changes as an ordered sequence of
explanations and their exact corresponding diffs.

## Product decisions

- Authoring is split into two files. `capture.json` is machine-owned capture data:
  a `captureId`, a `working-tree` `source` with a `from` commit endpoint and an ISO
  `capturedAt`, full old/new file snapshots, and derived `change-*` blocks. It never
  contains authored sections. `explanations.yaml` is the only author-edited file: it
  names the `captureId` it was authored against and holds ordered sections of
  `{ title, body?, html?, changes[] }`.
- `captureId` identifies captured code contents, not the capture timestamp. It is a
  SHA-256 over a canonical serialization of the captured file snapshots (status, path,
  old path, old content, new content), so identical captures pair consistently while
  changed content produces a different identity.
- `inspect` never overwrites an existing authored `explanations.yaml`. On first use it
  writes a small skeleton; on re-runs it preserves the authored file and refreshes
  `capture.json`. When the captured contents change, the preserved explanations target
  a stale `captureId` and `check` reports the mismatch with a next step.
- `explanations.yaml` is parsed as strict safe YAML 1.2 (the `yaml` package, core
  schema). Custom tags, duplicate keys, anchors, and aliases are rejected; YAML 1.1
  coercions (`yes`, `on`) stay plain strings; the result is validated by a strict Zod
  schema so numbers, booleans, and nulls are never coerced into strings.
- The final read model remains an ordered document of `{ explain: { title, body,
  html? }, diff }`. Every captured change ID must be assigned exactly once;
  materialization rejects unknown, duplicate, and unassigned IDs.
- `check`, `view`, `report`, and `export` read capture plus explanations, validate the
  pairing and assignments, and materialize exact patches in memory. No `document.json`
  is required at runtime; `export` writes the portable ExplainDocument JSON (format
  version 1) only for integrations and archiving.
- The agent should not hand-write unified patches for real working-tree changes.
  Pierre identifies `ChangeContent` blocks from complete old/new files; selected
  blocks are applied to the old content, then `diff` v9 creates a legal Git patch.
  Blocks can be explained separately even when Pierre renders them inside the same
  visual hunk.
- The report surface renders `body` as Markdown with raw HTML escaped, then inserts the
  optional trusted `html` fragment after it. The TUI reads only `body`.
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

- The HTML report is generated from the materialized document by `diffwalk report`.
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

- `src/format.ts`: Zod schemas for the machine-owned capture and the author-edited
  explanations, plus the version 1 ExplainDocument.
- `src/git.ts`: captures staged, unstaged, deleted, renamed, and untracked UTF-8
  files from an immutable Git base commit.
- `src/authoring.ts`: derives change blocks and the content `captureId`, and
  materializes exact section patches from capture plus explanations.
- `src/explanations.ts`: strict safe YAML 1.2 parsing into the explanations schema.
- `src/cli-args.ts`: shared flag/positional parsing and usage errors.
- `src/help.ts`: top-level and per-command help for purpose, quick start, file
  ownership, defaults, options, and next steps.
- `src/cli.ts`: executable entry point for `inspect`, `changes`, `change`, `file`,
  `check`, `view`, `report`, `export`, and `help`.
- `src/document.ts`: converts an ExplainDocument's patches into Hunk files.
- `src/reader.ts`: pure fold-state, visible-tree, and cursor logic for the reader.
- `src/main.tsx`: OpenTUI/React reader using Hunk's exported primitives.
- `src/report-patches.ts`: shared Pierre parse seam used by the generator, the browser
  client, and tests.
- `src/report-markdown.ts`: Markdown rendering with raw HTML escaped.
- `src/report.ts`: report shell generation, embedded-data escaping, atomic report writes,
  and client-bundle loading.
- `src/report-client.ts`: browser entry that mounts a `FileDiff` per file and switches
  unified/split through `setOptions`.
- `test/*.test.ts`: focused tests for schemas, capture identity, strict YAML parsing,
  materialization, Git capture, document input, reader folding, report schemas,
  Markdown escaping, embedded-data escaping, Pierre parse failures, CLI argument
  parsing, help, and atomic writes.
- `test/cli.test.ts`: end-to-end CLI tests in real temporary Git repositories for
  inspect file behavior (including preservation of authored explanations and stale
  pairing), inspection commands, validation, report/export inputs, and rejection of
  the removed `build`/draft workflow.
- `test/reader-ui.test.tsx`: end-to-end reader tests through a rendered OpenTUI/React app
  for keyboard navigation, folding, focus, scrolling, mouse folding, and quitting.
- `.agents/skills/diffwalk/SKILL.md`: teaches agents the authoring workflow and invariants.
