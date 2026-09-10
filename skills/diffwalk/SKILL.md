---
name: diffwalk
description: Use the Diffwalk CLI to capture working-tree or committed Git changes, author ordered explanations in the current `.diffwalk` walk, validate with check, and preview, export, publish, or remove the review. Trigger when the user asks to use Diffwalk or create/update its capture or explanations; do not trigger for ordinary code review that does not involve Diffwalk.
---

# Diffwalk

Use Diffwalk from the Git repository whose working-tree or committed changes should be
explained.

## Workflow

1. Confirm `diffwalk` is available with `command -v diffwalk`. If it is missing, report that installation is required; do not modify shell configuration without authorization.
2. Choose the capture that matches the requested change set:
   - Run `diffwalk inspect` for staged, unstaged, renamed, deleted, and untracked
     working-tree changes relative to `HEAD`. Use `--base <revision>` when the user
     names a different working-tree base.
   - Run `diffwalk inspect <commit>` for one commit relative to its first parent. A
     root commit has no first parent, so use an explicit range instead.
   - Run `diffwalk inspect --from <revision> --to <revision>` for a committed range.
     Committed captures ignore working-tree changes and record both supplied revision
     labels and resolved commit hashes.
   - Use `--output <path>` or `--explanations <path>` only when the user requests an
     explicit path.
3. Inspect what was captured with the focused read commands. Never open `capture.json` directly:
   - `diffwalk changes` for a concise summary, or `diffwalk changes --json` for structured IDs, paths, coordinates, before, and after.
   - `diffwalk change <id>` to read one captured change block.
   - `diffwalk file <path> --before` / `diffwalk file <path> --after` to read one captured file side.
4. Edit the generated explanations path printed by `inspect`. Diffwalk stores each
   authoring pair under `.diffwalk/<walkId>/` and records the selected walk in
   `.diffwalk/current`. Treat `captureId` as captured data: write `title`, an optional
   `summary`, and `sections`:

   ```yaml
   title: What this whole change set does
   summary: |
     Optional opening for someone deciding whether to read.
   sections:
     - title: A concise change title
       steps:
         - text: |
             Why this change exists and what it does.
           changes:
             - change-001
         - text: |
             What the next piece adds, once the first is understood.
           changes:
             - change-002
   ```

   `title` is required: it becomes the review heading and the browser tab, which is how
   two shared links tell themselves apart.

   A step carries `text`, `changes`, or both, so prose and diffs interleave in the order
   you write them. Prefer several short steps over one long one: the point of a step is
   that the reader sees the diff while the sentence about it is still on screen.

   `text` is Markdown and inline HTML passes through, so a diagram can sit exactly where
   the argument needs it. Embed every image as an inline `<svg>` or a `data:` URI: a
   remote image URL renders in the local file but is blocked on the hosted review.

5. Show every captured change at least once. Do not invent IDs or leave one unexplained.
   Showing a change in more than one step is allowed when re-showing a hunk builds the
   argument; `check` names the repeats and still succeeds.
6. Run `diffwalk check` before viewing or exporting. Fix any stale `captureId`, malformed YAML, unknown ID, unexplained change, or materialization mismatch it reports.
7. Run `diffwalk view` when the user asks to preview the review locally. It opens the browser without writing an HTML file and runs until stopped with Ctrl+C.
8. Run `diffwalk export html` when the user asks for a portable HTML review, or `diffwalk export json` for an ExplainDocument integration artifact. Pass `--output <path>` when the user names a destination.
9. Run `diffwalk publish` only when the user explicitly asks to publish. Publishing is
   an external write: it uploads the materialized review to an unlisted, publicly
   readable URL. Return both the URL and the one-time revocation token without placing
   the token in the review. Use `diffwalk unpublish <id> --token <token>` only when the
   user asks to remove that exact review.

## Writing explanations

Make the change understandable before making it comprehensive. Name the behavior or
decision in each section title; order sections by what the reader needs to learn,
not by filename. Explain why related changes belong together, then attach their
actual change IDs. Keep each explanation close to the diff it explains.

Use the smallest visual that resolves a real question. A short sentence is enough
for a simple edit; do not add a diagram to every section or force a fixed number of
steps. For cross-file changes, show the relationship that individual hunks cannot.

| Reader's question | Useful form inside a step's `text` |
| --- | --- |
| What decision changed? | A small pseudocode block with the relevant branches |
| What runs next? | A call tree showing execution order |
| Which component owns the state? | A component tree with real module paths and state boundaries |
| Where did responsibilities move? | A shallow file tree annotated with responsibilities |
| How did the structure change? | A before/after sketch or a fenced `diff` of the conceptual tree |
| How do these pieces communicate? | An inline SVG flow or sequence diagram |

Keep only the calls, files, states, and boundaries needed for the current point.
Use names from the captured source; distinguish existing behavior from new behavior.
Label pseudocode and conceptual sketches so they cannot be mistaken for exact source
patches. Never use a hand-written sketch in place of a captured change ID.

For example, a short overview can establish the reading order before the associated
diffs. Use `summary` for the whole review, or a text-only step for a local explanation:

````yaml
summary: |
  Deleting a project now starts a recovery window instead of removing its row.

  Lifecycle overview (conceptual):

  ```text
  Delete -> mark deleted_at
              |-> active list hides the project
              |-> restore clears the timestamp within 30 days
              `-> cleanup removes expired rows
  ```
````

Follow that overview with steps about the real query, UI, and cleanup changes, each
referencing IDs returned by `diffwalk changes`. Do not repeat the whole diagram
beside every hunk. Show a complete code block only when the omitted context would
hide ownership or order; otherwise let Diffwalk's exact diff carry the code.

### Visuals stay in the review

- Put a visual beside its supporting prose in `summary` or `steps[].text`, not in a
  separate HTML page, slide deck, or screenshot. Preview through `diffwalk view`.
- Fenced `text`, `tsx`, and `diff` blocks are readable sketches. Mermaid fences do
  not automatically become diagrams in Diffwalk; use a text sketch or self-contained
  inline SVG instead of adding a Mermaid runtime or CDN dependency.
- For SVG, include a `viewBox`, a descriptive title or accessible label, and fluid
  sizing such as `style="max-width:100%;height:auto"`. Keep labels legible on narrow
  screens; split a dense diagram rather than shrinking it to unreadable text.
- Match the review's restrained green, gray, and white palette. Do not build an
  unrelated visual theme, interactive controls, or animations inside explanations.
- Embed image data and SVG directly. Do not reference remote images, scripts, fonts,
  stylesheets, or local file paths: the exported review must work offline and the
  hosted review blocks remote image sources.
- `diffwalk check` validates the capture/explanation pairing, not the truth of a
  diagram or its layout. Check labels and arrows against the source, then preview
  visuals at desktop and narrow widths when authoring them.

## Invariants

- Never hand-write the final unified diffs. Diffwalk materializes selected change blocks from captured old/new contents and generates the patches.
- Never edit or hand-parse `capture.json`. It is machine-owned; read it only through `changes`, `change`, and `file`.
- Treat each change ID as independently assignable even when multiple IDs appear inside one rendered hunk.
- Keep explanations ordered for comprehension rather than source-file order when that improves the walkthrough.
- Do not edit captured file contents or change coordinates to force a check. Re-run
  `diffwalk inspect` when the working tree has changed; it creates a new current walk
  and never overwrites an authored `explanations.yaml`.
- Executable modes are preserved for additions, deletions, renames, and content
  changes. A chmod-only change has no representable explanation block, so stop when
  Diffwalk reports it. Also stop for binary files, symbolic links, or non-file Git
  paths; do not bypass these boundaries.
- Treat a pure rename as a real assignable change. Diffwalk renders it as a move rather
  than an empty textual diff.
- The capture contains full file contents. Treat it as potentially sensitive and do not publish or send it without the user's authorization.

## Commands

```bash
diffwalk inspect [revision] [--base <revision>] [--from <revision> --to <revision>] [--output <capture-path>] [--explanations <yaml-path>]
diffwalk changes [--json] [--input <capture-path>]
diffwalk change <id> [--input <capture-path>]
diffwalk file <path> (--before | --after) [--input <capture-path>]
diffwalk check [--input <capture-path>] [--explanations <yaml-path>]
diffwalk view [--input <capture-path>] [--explanations <yaml-path>]
diffwalk export <html|json> [--input <capture-path>] [--explanations <yaml-path>] [--output <path>]
diffwalk publish [--input <capture-path>] [--explanations <yaml-path>] [--service <url>]
diffwalk unpublish <id> --token <token> [--service <url>]
```

## Trusted-text boundary

- `text` and `summary` render as Markdown in reviews, and inline HTML passes through, so
  authored markup lands exactly where it was written.
- The review embeds every document diff and renders it with the `@pierre/diffs` runtime
  bundled into the file; there is no CDN or external asset, so the review works offline.
- A section whose diff cannot be parsed stops `diffwalk view` or `diffwalk export html` with a clear message; it
  is never silently dropped.
- Build reviews only from documents you or a trusted agent authored. Authored markup is
  inserted without sanitization and can run scripts, so never add untrusted or
  third-party content to a review.
