# Usage

Install the CLI and optional agent skill using the [README](../README.md#installation).
This guide covers manual authoring and the full CLI workflow.
To run commands without installing globally, use `npx diffwalk inspect` (and
`npx diffwalk <command>` for later commands).

## Capture and explain changes

Inside the Git working tree whose changes you want to explain:

```bash
diffwalk inspect
diffwalk changes
```

`inspect` captures staged, unstaged, and untracked file changes relative to `HEAD`,
including binary assets. It creates a walk under `.diffwalk/` containing:

- `capture.json` — generated capture data. Do not edit it.
- `explanations.yaml` — the file you edit to explain and order the changes.

Edit `explanations.yaml`, keeping its generated `captureId` and using the change IDs
from `diffwalk changes`:

```yaml
captureId: <keep the generated value>
title: Simplify greetings
summary: Make greetings shorter and add a farewell.
metadata:
  explainedBy: Claude Code
sections:
  - title: Shorten the greeting
    steps:
      - text: The extra phrase is no longer needed.
        changes:
          - change-001
  - title: Add a farewell
    steps:
      - text: Give callers a matching way to say goodbye.
        changes:
          - change-002
```

`title` is required; `summary` and `metadata.explainedBy` are optional. Sections and
steps appear in the order you write them. Each step can contain `text`, `changes`, or
both. Include every captured change at least once; repeats are allowed.

Validate and preview the review:

```bash
diffwalk check
diffwalk view
```

`view` opens a local browser preview. Press Ctrl+C to stop its temporary server.
To share the review, export a standalone file or publish a link:

```bash
diffwalk export html
diffwalk publish
```

Add the local workspace to `.gitignore`; it contains full captured file contents and
publication tokens:

```gitignore
.diffwalk/
```

## Capture options

Capture selected working-tree changes:

```bash
diffwalk inspect --staged                          # staged changes only
diffwalk inspect --path src/a.ts --path src/b.ts   # selected literal paths
diffwalk inspect --staged --path src/a.ts          # both
diffwalk inspect --base main                       # working tree relative to main
diffwalk inspect --exclude experiments             # omit a file or directory
diffwalk inspect --exclude notes.md --exclude experiments
diffwalk inspect --exclude src/legacy --path src   # exclusion wins inside a selected path
diffwalk inspect --pathspec ':(glob)src/**/*.ts'   # Git glob pathspec
diffwalk inspect --pathspec ':(exclude)pnpm-lock.yaml'  # Git exclusion pathspec
diffwalk inspect --pathspec ':(glob)src/**/*.ts' --exclude src/legacy
```

`--path` is repeatable and takes literal file or directory paths relative to the
repository root. Diffwalk disables Git pathspec magic for these values, so `*`, `?`,
`[`, and a leading `:` name literal filenames; `--path 'notes[1].md'` selects that
exact file. A directory selects everything under it on path boundaries.

`--pathspec` is repeatable and hands each expression to Git as a pathspec, so Git's
pathspec semantics apply. `:(glob)src/**/*.ts` selects matching files with a glob, and
`:(exclude)pnpm-lock.yaml` drops a file from the scope. Pass the expression directly
after the option and quote it so the shell does not expand it before Git receives it.
Because the expression reaches Git, an exclusion pathspec is part of the initial Git
scope. `--path` and `--pathspec` are mutually exclusive; choose one selection mode per
capture.

`--exclude` is repeatable and takes literal file or directory paths relative to the
repository root. It composes with either selection mode. A directory excludes everything
under it on path boundaries, so `--exclude experiments` also omits `experiments/old.ts`
but not `experiments.ts`. The scope and `--exclude` values combine: a change is captured
when it matches the scope (or the scope is empty) and matches no `--exclude` value, so an
exclusion always wins. `--exclude` values are always literal, so `--exclude
'notes[1].md'` names that exact file and never a Git pattern. Exclusions apply to
working-tree captures (including untracked files) and to `--staged` captures, and are
applied before Diffwalk reads or validates files, so an unsupported file outside the
requested scope cannot block the capture.
Selection happens in two stages. Diffwalk hands Git the `--path` or `--pathspec` scope
first, and Git detects renames among the changes that survive it. Diffwalk then drops
`--exclude` paths from the result. Git may read excluded file contents while it looks
for similarities, so exclusions cannot hide content from Git's rename detection, but
Diffwalk never reads or validates an omitted side. Rename detection is a heuristic, and
a rename that crosses an initial selection boundary may lose its relationship and appear
as an ordinary addition or deletion; only `--exclude` keeps detected moves, and only when
both sides survived the initial scope. This includes an exclusion pathspec, which Git
applies as part of the initial scope. When a detected rename crosses an `--exclude`
boundary, the review keeps both paths and shows `Moved to excluded path` or `Moved from
excluded path`, omits the excluded side's content explicitly rather than as an empty file,
and drops a rename whose both sides are excluded.
When the selection matches no changes, `inspect` stops with `Nothing to capture` instead
of writing an empty walk. Say which paths you excluded when you share the review, since
the review cannot show changes that were never captured.

Or capture committed changes without checking out either revision:

```bash
diffwalk inspect <commit>                # commit relative to its first parent
diffwalk inspect --from main --to feature # compare two committed revisions
```

Revision captures ignore local changes and cannot be limited by `--path`, `--pathspec`,
or `--exclude`. Single-commit inspection requires a parent, so it does not support root
commits.

`.diffwalk/current` selects the walk used by later commands. Capturing the same source
and contents reuses it; a different capture creates a new walk and preserves previous walks.
`captureId` ties explanations to their captured contents, so `check` catches stale
pairings.

## Manage walks

Each capture lives in its own timestamped directory under `.diffwalk/`. List the walks,
select one as current, or remove one by its explicit ID:

```bash
diffwalk walks             # list walks, newest first, and mark the current one
diffwalk use <walk-id>     # make another walk current
diffwalk delete <walk-id>  # remove one walk
```

`delete` requires the walk ID. Deleting the current walk clears `.diffwalk/current`;
select another with `use` before running later commands.

## Inspect captured changes

Read captured data with:

```bash
diffwalk changes                # summary of all change blocks
diffwalk changes --json         # IDs, paths, coordinates, before and after blocks
diffwalk change change-001      # one block with its contents
diffwalk file src/a.ts --before # full captured old file
diffwalk file src/a.ts --after  # full captured new file
```

`changes --json` includes change blocks, not full file snapshots.

Text changes list line coordinates and their before/after blocks. Binary changes keep
only an identity, never the bytes: `changes` shows the status and each existing side's
byte size, `changes --json` and `change <id>` add the content hash, and
`file <path> --before/--after` prints that metadata instead of bytes. A file that
switches between text and binary keeps both side identities. Binary change IDs are
assigned to steps like any other change.

## Binary assets

Diffwalk represents binary files at file level. It records the path, change status,
file modes, and each existing side's byte size and SHA-256 content hash, and assigns
the file a change ID rendered as a metadata card instead of a textual patch. Because
the hash participates in `captureId`, two binary revisions of the same size are still
distinguished, and `check` re-validates the captured metadata before it passes.

Diffwalk treats a file side as binary when its bytes contain a NUL byte or do not
decode as UTF-8, so a non-UTF-8 text file is captured as an opaque card rather than
shown as text. Diffwalk does not generate binary patches, preview images, or decode
binary contents, so a binary card shows identity rather than the changed bytes.
Symbolic links and non-file Git paths are still rejected at capture time.

## Validation

`diffwalk check` rejects stale capture IDs, malformed YAML, unknown change IDs,
unexplained changes, and blocks that cannot produce an exact patch or whose binary
metadata no longer matches the captured file. It reports section, step, change, and
file counts, including repeated changes.

Explanations use YAML 1.2. Custom tags, duplicate keys, anchors, and aliases are not
allowed; `yes` and `on` remain strings.

## Export

```bash
diffwalk export html                    # writes diffwalk.html in the current walk
diffwalk export html --output review.html
diffwalk export json --output document.json
```

HTML reviews are standalone files that work offline with JavaScript enabled. JSON
export produces an ExplainDocument (format version 1) for integrations or archiving;
its default filename is `diffwalk.json` in the current walk.

Both exports, and the hosted review, keep a binary change's card with its path, status,
and before/after sizes.

`text` and `summary` support Markdown and inline HTML. Use inline SVG or `data:` URIs
for images; hosted reviews block remote image URLs. Authored HTML is not sanitized,
so only preview, export, or publish explanations you or a trusted agent authored.

## Hosted reviews

```bash
diffwalk publish          # creates an unlisted link
diffwalk publish --update # replaces the review at the existing link
```

Publishing uploads the review document, which the service renders. Links are
anonymous and unlisted: anyone with the link can read the review without signing in.
Check captured code and explanations for sensitive data before sharing.

Attribution can include:

- `explainedBy` — from `metadata.explainedBy` in the explanations.
- `publishedBy` — from `git config user.name`, if configured.
- `publishedAt` — set by the service when it accepts the upload.

Names are self-reported, not verified identities. Publishing adds attribution to the
uploaded document without changing the authoring files. Local previews and exports
include only `explainedBy`.

The local `published.json` stores the review ID, URL, service, and revocation token.
Keep it out of version control. Use the token to remove a review:

```bash
diffwalk unpublish <review-id> --token <revocation-token>
```

Losing the token and `published.json` prevents revocation. Running `diffwalk publish`
again creates a new link and replaces the saved publication details. Save the old
token first if you need to revoke the earlier review later.

### Choosing the review service

`https://review.diffwalk.dev` is the default hosted service. Self-hosting it is optional;
[Development](development.md#review-service) describes running your own. To point a project at another
service without passing `--service` every time, add `.diffwalk/config.json` beside the
walks:

```json
{
  "service": "https://review.example.com"
}
```

`.diffwalk/` also holds captured file contents and publication tokens and is kept out of
version control, so this config is local to the project and separate from every walk's
`capture.json`, `explanations.yaml`, and `published.json`.

For a new publication or `diffwalk unpublish`, the service is resolved in this order:

1. `--service <url>`.
2. `.diffwalk/config.json`.
3. `https://review.diffwalk.dev`.

The config is the `.diffwalk/config.json` at the root of the Git work tree, so commands
work from any project subdirectory. A config above the work tree is not part of the
project and is ignored. `--input` and `--explanations` do not move the lookup: the config
is never read from the input files' directory. Outside a Git work tree there is no
project config, so the flag and the default still apply. `DIFFWALK_SERVICE_URL` is not
consulted: setting it has no effect.

The configured value is validated and normalized like `--service`: only the origin is
kept, plaintext HTTP is refused except for `localhost` and `127.0.0.1`, and a malformed
config or invalid URL stops the command instead of quietly falling back to the default.

`publish --update` ignores this resolution. It always uses the service retained in the
walk's `published.json` and refuses an explicit `--service` that differs, so changing
project config cannot redirect an existing review or send its revocation token to another
service.

## Explicit input files

Commands default to the current walk. To use another authoring pair:

```bash
diffwalk check --input path/to/capture.json --explanations path/to/explanations.yaml
```

`view`, `export`, and `publish` accept the same options. With explicit input files,
`publish` saves `published.json` alongside the authoring pair.
