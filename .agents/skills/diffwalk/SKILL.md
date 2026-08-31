---
name: diffwalk
description: Use the Diffwalk CLI to capture Git working-tree changes, author ordered explanations in the current `.diffwalk` walk, validate with check, and preview, export, or publish the report. Trigger when the user asks to use Diffwalk or create/update its capture or explanations; do not trigger for ordinary code review that does not involve Diffwalk.
---

# Diffwalk

Use Diffwalk from the Git repository whose uncommitted changes should be explained.

## Workflow

1. Confirm `diffwalk` is available with `command -v diffwalk`. If it is missing, report that installation is required; do not modify shell configuration without authorization.
2. Run `diffwalk inspect`. Use `--base <revision>`, `--output <path>`, or `--explanations <path>` only when the user requests a non-default base or path.
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

   `title` is required: it becomes the report heading and the browser tab, which is how
   two shared links tell themselves apart.

   A step carries `text`, `changes`, or both, so prose and diffs interleave in the order
   you write them. Prefer several short steps over one long one: the point of a step is
   that the reader sees the diff while the sentence about it is still on screen.

   `text` is Markdown and inline HTML passes through, so a diagram can sit exactly where
   the argument needs it. Embed every image as an inline `<svg>` or a `data:` URI: a
   remote image URL renders in the local file but is blocked on the hosted report.

5. Show every captured change at least once. Do not invent IDs or leave one unexplained.
   Showing a change in more than one step is allowed when re-showing a hunk builds the
   argument; `check` names the repeats and still succeeds.
6. Run `diffwalk check` before viewing or exporting. Fix any stale `captureId`, malformed YAML, unknown ID, unexplained change, or materialization mismatch it reports.
7. Run `diffwalk view` when the user asks to preview the report locally. It opens the browser without writing an HTML file and runs until stopped with Ctrl+C.
8. Run `diffwalk export html` when the user asks for a portable HTML report, or `diffwalk export json` for an ExplainDocument integration artifact. Pass `--output <path>` when the user names a destination.

## Invariants

- Never hand-write the final unified diffs. Diffwalk materializes selected change blocks from captured old/new contents and generates the patches.
- Never edit or hand-parse `capture.json`. It is machine-owned; read it only through `changes`, `change`, and `file`.
- Treat each change ID as independently assignable even when multiple IDs appear inside one rendered hunk.
- Keep explanations ordered for comprehension rather than source-file order when that improves the walkthrough.
- Do not edit captured file contents or change coordinates to force a check. Re-run
  `diffwalk inspect` when the working tree has changed; it creates a new current walk
  and never overwrites an authored `explanations.yaml`.
- Stop and report errors for binary files, symbolic links, unsupported file types, or file-mode changes. Do not bypass these boundaries.
- The capture contains full file contents. Treat it as potentially sensitive and do not publish or send it without the user's authorization.

## Commands

```bash
diffwalk inspect [--base HEAD] [--output <capture-path>] [--explanations <yaml-path>]
diffwalk changes [--json] [--input <capture-path>]
diffwalk change <id> [--input <capture-path>]
diffwalk file <path> (--before | --after) [--input <capture-path>]
diffwalk check [--input <capture-path>] [--explanations <yaml-path>]
diffwalk view [--input <capture-path>] [--explanations <yaml-path>]
diffwalk export <html|json> [--input <capture-path>] [--explanations <yaml-path>] [--output <path>]
```

## Trusted-text boundary

- `text` and `summary` render as Markdown in reports, and inline HTML passes through, so
  authored markup lands exactly where it was written.
- The report embeds every document diff and renders it with the `@pierre/diffs` runtime
  bundled into the file; there is no CDN or external asset, so the report works offline.
- A section whose diff cannot be parsed stops `diffwalk view` or `diffwalk export html` with a clear message; it
  is never silently dropped.
- Build reports only from documents you or a trusted agent authored. Authored markup is
  inserted without sanitization and can run scripts, so never add untrusted or
  third-party content to a report.
