# diffwalk

diffwalk turns AI-generated Git changes into ordered browser walkthroughs, with every
explanation attached to its exact diff.

## Requirements

- Git.
- Node.js 22 or 24.
- A browser with JavaScript enabled to read reviews.

## Installation

```bash
npm install --global diffwalk
```

Or run commands without installing globally: `npx diffwalk inspect`.

## Quick start

Inside the Git working tree whose changes you want to explain:

```bash
diffwalk inspect
diffwalk changes
```

`inspect` captures staged, unstaged, and untracked UTF-8 file changes relative to
`HEAD`. It creates a walk under `.diffwalk/` containing:

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
diffwalk inspect --staged             # staged changes only
diffwalk inspect -- src/a.ts src/b.ts # selected paths
diffwalk inspect --staged -- src/a.ts  # both
diffwalk inspect --base main          # working tree relative to main
```

Or capture committed changes without checking out either revision:

```bash
diffwalk inspect <commit>                # commit relative to its first parent
diffwalk inspect --from main --to feature # compare two committed revisions
```

Revision captures ignore local changes and cannot be limited by path. Single-commit
inspection requires a parent, so it does not support root commits.

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

## Validation

`diffwalk check` rejects stale capture IDs, malformed YAML, unknown change IDs,
unexplained changes, and blocks that cannot produce an exact patch. It reports
section, step, change, and file counts, including repeated changes.

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

Use `--service https://review.example` or `DIFFWALK_SERVICE_URL` to publish to another
service.

## Explicit input files

Commands default to the current walk. To use another authoring pair:

```bash
diffwalk check --input path/to/capture.json --explanations path/to/explanations.yaml
```

`view`, `export`, and `publish` accept the same options. With explicit input files,
`publish` saves `published.json` alongside the authoring pair.

## Agent skill

Install the included skill to teach a compatible coding agent how to capture,
explain, and validate changes:

```bash
npx skills add minipai/diffwalk --skill diffwalk
```

Add `-g` to install globally. From a local checkout, use:

```bash
npx skills add ./skills/diffwalk --skill diffwalk
```

The skill is separate from the CLI installation. Start a new agent session after
installing it. Source: [skills/diffwalk/SKILL.md](skills/diffwalk/SKILL.md).

## Development

Additional dependencies:

- Bun 1.3 or newer.
- pnpm 11.20.0, as pinned in `package.json`.

```bash
pnpm install
pnpm build
pnpm check
```

`pnpm check` runs type checks and tests. Pull requests targeting `main` run the same
check in CI.

### Running the review service

The service uses a Cloudflare Worker, a private R2 bucket, and shared static assets.

```bash
export CLOUDFLARE_API_TOKEN=...   # zone WAF and ruleset edit
export CLOUDFLARE_ZONE_ID=...
./infra/setup.sh                 # bucket, r2.dev off, WAF, rate limits
pnpm deploy
```

`wrangler.jsonc` configures the Worker, static assets, and R2 binding.
`infra/setup.sh` configures zone-level settings and is safe to rerun.
