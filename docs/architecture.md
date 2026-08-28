# Architecture

Diffwalk is a standalone TUI for reading code changes as an ordered sequence of
explanations and their exact corresponding diffs.

## Product decisions

- The final read model is ordered `sections`, where every item is
  `{ explain: { title, body }, diff }`.
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
- The TUI has no sidebar. `j`/`k` changes section, `Space` or clicking the code
  header folds that section's diff, `1`/`2` selects split/stack layout, and `q`
  quits. Fold state is remembered independently per section.

## Source map

- `src/format.ts`: Zod schemas for the authoring draft and final document.
- `src/git.ts`: captures staged, unstaged, deleted, renamed, and untracked UTF-8
  files from an immutable Git base commit.
- `src/authoring.ts`: creates change blocks, validates assignments, and materializes
  section patches.
- `src/cli.ts`: executable entry point for `inspect`, `build`, and `view`.
- `src/document.ts`: converts document patches into Hunk files.
- `src/main.tsx`: OpenTUI/React reader using Hunk's exported primitives.
- `test/*.test.ts`: nine focused tests for authoring, Git capture, and document input.
- `.agents/skills/diffwalk/SKILL.md`: teaches agents the authoring workflow and invariants.
