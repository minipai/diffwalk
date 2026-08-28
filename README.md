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

## Reader controls

- `j` / `k` or arrow keys: move between sections
- `Space` or click the code header: fold or unfold the active section's diff
- `1`: split diff layout
- `2`: stacked diff layout
- `q` or `Escape`: quit
