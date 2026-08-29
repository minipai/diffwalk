---
name: diffwalk
description: Use the Diffwalk CLI to capture Git working-tree changes, author ordered explanations in explanations.yaml, validate with check, and open the reader or HTML report. Trigger when the user asks to use Diffwalk or create/update its `.explain` capture or explanations; do not trigger for ordinary code review that does not involve Diffwalk.
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
4. Edit the generated `.explain/explanations.yaml`. Treat its `captureId` as captured data: edit only `sections`. Each section must contain:

   ```yaml
   sections:
     - title: A concise change title
       body: |
         Why this change exists and what it does.
       changes:
         - change-001
   ```

   Keep `body` a complete explanation on its own. When a visual would help, add an
   optional `html` field holding agent-authored markup such as cards, tables, or inline
   SVG. The report inserts `html` after the rendered Markdown `body` and treats it as
   trusted authored HTML; the terminal reader reads only `body`. Embed any assets —
   including SVG — directly in the fragment so the report stays one self-contained file.
   Do not put raw HTML in `body`: it is rendered as Markdown and raw tags are escaped.

5. Assign every captured change ID exactly once. Do not invent IDs, reuse an ID, or leave an ID unassigned. A section may contain multiple IDs when they form one coherent explanation.
6. Run `diffwalk check` before viewing or reporting. Fix any stale `captureId`, malformed YAML, duplicate or unknown assignment, unassigned ID, or materialization mismatch it reports.
7. Run `diffwalk view` when the user asks to open or inspect the terminal reader. Exit with `q`.
8. Run `diffwalk report` when the user asks for an HTML report. The report is one portable file with no CDN or external assets and opens as a local file with JavaScript enabled. Pass `--output <path>` when the user names a destination.

## Invariants

- Never hand-write the final unified diffs. Diffwalk materializes selected change blocks from captured old/new contents and generates the patches.
- Never edit or hand-parse `capture.json`. It is machine-owned; read it only through `changes`, `change`, and `file`.
- Treat each change ID as independently assignable even when multiple IDs appear inside one rendered hunk.
- Keep explanations ordered for comprehension rather than source-file order when that improves the walkthrough.
- Do not edit captured file contents or change coordinates to force a check. Re-run `diffwalk inspect` when the working tree has changed; it never overwrites an authored `explanations.yaml`.
- Stop and report errors for binary files, symbolic links, unsupported file types, or file-mode changes. Do not bypass these boundaries.
- The capture contains full file contents. Treat it as potentially sensitive and do not publish or send it without the user's authorization.

## Commands

```bash
diffwalk inspect [--base HEAD] [--output .explain/capture.json] [--explanations .explain/explanations.yaml]
diffwalk changes [--json] [--input .explain/capture.json]
diffwalk change <id> [--input .explain/capture.json]
diffwalk file <path> (--before | --after) [--input .explain/capture.json]
diffwalk check [--input .explain/capture.json] [--explanations .explain/explanations.yaml]
diffwalk view [--input .explain/capture.json] [--explanations .explain/explanations.yaml]
diffwalk report [--input .explain/capture.json] [--explanations .explain/explanations.yaml] [--output .explain/report.html]
diffwalk export [--input .explain/capture.json] [--explanations .explain/explanations.yaml] [--output .explain/document.json]
```

## Trusted-html boundary

- `body` is rendered as Markdown in reports; raw HTML in `body` is escaped. All authored
  markup goes in `html`, which the report inserts after the Markdown body as trusted HTML.
- The report embeds every document diff and renders it with the `@pierre/diffs` runtime
  bundled into the file; there is no CDN or external asset, so the report works offline.
- A section whose diff cannot be parsed stops `diffwalk report` with a clear message; it
  is never silently dropped.
- Build reports only from documents you or a trusted agent authored. `html` is inserted
  without sanitization and can run scripts, so never add untrusted or third-party content
  to a report.
