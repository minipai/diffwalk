# Diffwalk

Diffwalk is a standalone terminal UI for reading code changes as an ordered sequence of
explanations and their exact corresponding diffs.

Diffwalk requires Bun 1.3 or newer. Development commands below also require pnpm.

## Development

Install the dependencies, build the executable, and run the test suite:

```bash
pnpm install
pnpm build
pnpm test
```

Run the included document to smoke-test the TUI without installing the executable:

```bash
pnpm diffwalk view fixtures/document.json
```

Render the same document as a portable, self-contained HTML report:

```bash
pnpm diffwalk report fixtures/document.json --output report.html
```

The report opens in any browser as a local file: it embeds the document, Markdown
rendering, the diff renderer, and all styles, so it makes no CDN or network requests.
It bundles the full Pierre diff runtime (about 10.7 MB) so every language is
syntax-highlighted offline.

## Agent skill

The repository includes an Agent Skill that teaches compatible coding agents how to capture
changes, author ordered sections, and build the document without hand-writing patches. Its
source lives at `.agents/skills/diffwalk`.

Link it into the shared user-level Agent Skills directory to make it available from other
repositories:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd)/.agents/skills/diffwalk" "$HOME/.agents/skills/diffwalk"
```

Agents that use another skill directory can point that directory at the same `SKILL.md`.
Start a new agent session after installing the skill so it can be discovered.

## Usage

Run `diffwalk inspect` inside the Git working tree whose changes you want to explain:

```bash
diffwalk inspect
```

This captures staged, unstaged, renamed, deleted, and untracked UTF-8 files relative to
`HEAD` and writes `.explain/draft.json`. You can select a different Git base or output path:

```bash
diffwalk inspect --base main --output .explain/draft.json
```

Edit the draft's `sections` array into the desired reading order. Each section has an
explanation and one or more temporary IDs from the top-level `changes` array:

```json
{
  "explain": {
    "title": "Keep the greeting concise",
    "body": "The extra phrase is no longer needed."
  },
  "changes": ["change-003"]
}
```

Every change ID must be assigned exactly once. Build the draft into a final document,
then open it in the reader:

```bash
diffwalk build
diffwalk view .explain/document.json
```

Custom input and output paths are also supported:

```bash
diffwalk build --input path/to/draft.json --output path/to/document.json
diffwalk view path/to/document.json
```

When working from this checkout without installing or linking its executable, prefix the
same commands with `pnpm` (for example, `pnpm diffwalk inspect`).

The final document contains only ordered sections shaped as
`{ "explain": { "title": "...", "body": "..." }, "diff": "..." }`. Temporary change IDs
and captured full file contents remain in the authoring draft and are not copied into the
final document.

## HTML reports

Turn a final document into a single self-contained HTML report:

```bash
diffwalk report .explain/document.json --output report.html
```

Without `--output` the report is written next to the document with a `.html` extension.
The report is one portable file: it embeds the document data, the Markdown-rendered
explanations, the `@pierre/diffs` runtime that parses and renders each exact diff, and all
styles. It works offline as a local file with JavaScript enabled and requests no CDN or
external assets.

`body` is rendered as Markdown and raw HTML inside it is escaped. Agent-authored
supplementary markup belongs in the optional `html` field of an explanation, which the
report inserts after the Markdown body as trusted authored HTML:

```json
{
  "explain": {
    "title": "Give the reader a stable cursor model",
    "body": "Keyboard navigation needs an identity that survives folding.",
    "html": "<figure><svg viewBox=\"0 0 640 180\" role=\"img\">...</svg></figure>"
  },
  "diff": "diff --git ..."
}
```

Fragments are treated as trusted input: build reports only from documents you or a
trusted agent authored. The `body` must remain a complete explanation on its own, and
visuals should embed their assets (including SVG) directly in the fragment so the report
stays self-contained. The TUI still reads only `body` and never interprets HTML.

The report shell offers native section and file folding plus unified/split layout
selection. It intentionally does not reproduce the TUI's keyboard navigation. Reports are
built only from version 1 documents; a section whose diff Pierre cannot parse stops the
command with a clear message instead of being dropped.

## Reader controls

The reader shows every explanation in document order as one vertically scrollable tree.
Move between explanation and file headers with the keyboard; the focused header stays in
view while scrolling.

- `j` / `↓`: move focus to the next visible header
- `k` / `↑`: move focus to the previous visible header
- `Enter` / `Space`: fold or unfold the focused header
- Click an explanation header to focus, fold, or unfold its body and file diffs
- Click a file header to focus, fold, or unfold just that file's diff
- `1`: split diff layout
- `2`: stacked diff layout
- `q` or `Escape`: quit

Scroll with the mouse or trackpad as well.
