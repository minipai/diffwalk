# Diffwalk

Diffwalk turns code changes into browser reports that present explanations and their
exact corresponding diffs in a deliberate order.

The CLI requires Node.js 20 or newer. Development commands below also require Bun 1.3
or newer and pnpm.

## Installation

Install Diffwalk globally from npm:

```bash
npm install --global diffwalk
```

Or run it without a global installation:

```bash
npx diffwalk inspect
```

## Development

Install the dependencies, build the executable, and run the test suite:

```bash
pnpm install
pnpm build
pnpm test
```

## Quick start

Inside the Git working tree whose changes you want to explain:

```bash
diffwalk inspect
```

This captures staged, unstaged, renamed, deleted, and untracked UTF-8 files relative to
`HEAD` and writes two authoring files:

- `.explain/capture.json` — machine-owned capture data (source, full file snapshots,
  change blocks, and a `captureId`). Never edit it by hand.
- `.explain/explanations.yaml` — a small authoring skeleton on first use. This is the
  only file you edit.

Name the change set, then order the `sections` array. Each section is a title over an
ordered list of `steps`, and a step carries `text`, `changes`, or both, so prose and
diffs interleave in the order you write them:

```yaml
captureId: d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4
title: Keep the greeting concise
summary: |
  Optional opening, shown above the review map.

  <figure><svg viewBox="0 0 640 180" role="img">...</svg></figure>
sections:
  - title: Keep the greeting concise
    steps:
      - text: |
          The extra phrase is no longer needed.
        changes:
          - change-001
  - title: Add a farewell
    steps:
      - text: Why a farewell belongs here at all.
      - text: A small module that says goodbye.
        changes:
          - change-002
```

`title` is required: it becomes the report heading and the browser tab, which is how two
shared links tell themselves apart. `summary` is optional.

Every change must be shown at least once. Showing one in more than one step is allowed
and reported, because re-showing a hunk is how an argument gets built. Validate, then
read or share:

```bash
diffwalk check
diffwalk view
diffwalk export html
diffwalk publish
```

The default workflow stays terse; every command also accepts explicit overrides:

```bash
diffwalk inspect --base main --output .explain/capture.json
diffwalk check --input .explain/capture.json --explanations .explain/explanations.yaml
diffwalk view --input .explain/capture.json --explanations .explain/explanations.yaml
diffwalk export html --output report.html
diffwalk export json --output .explain/document.json
diffwalk publish --service https://reports.example
```

## Inspecting what was captured

Capture data is machine-owned, so read it through focused commands instead of opening
`capture.json`:

```bash
diffwalk changes             # concise human summary of every change block
diffwalk changes --json      # structured IDs, paths, coordinates, before, after
diffwalk change change-001   # one captured block with its contents
diffwalk file src/a.ts --before   # the exact captured old side of a file
diffwalk file src/a.ts --after    # the exact captured new side
```

`changes --json` never includes full captured file contents. `change` rejects unknown
IDs and `file` rejects unknown paths or an invalid `--before`/`--after` selection.

## How the authoring files pair

`capture.json` holds a `captureId` that identifies the captured code contents, not the
capture timestamp: identical captures pair consistently, and changed contents produce a
different identity. `explanations.yaml` names the `captureId` it was authored against.
`diffwalk inspect` never overwrites an authored `explanations.yaml`: if the working tree
changed, it refreshes `capture.json` and `diffwalk check` reports the stale `captureId`
with a next step instead of silently breaking your authoring file.

## Validation

`diffwalk check` reads capture plus explanations and rejects stale `captureId`
pairing, malformed YAML, unknown change IDs, changes left unexplained, and any change
block that no longer materializes to an exact patch. On success it reports section,
step, change, and file counts, and names any change shown in more than one place.

The explanations file is parsed as strict safe YAML 1.2: custom tags, duplicate keys,
and anchors or aliases are rejected, and YAML 1.1-style coercions (`yes`, `on`) stay
plain strings.

## Local preview

`diffwalk view` materializes the report, starts a temporary loopback-only server, and
opens it in the default browser. It writes no HTML file. The server remains available
until you press Ctrl+C.

## HTML reports

```bash
diffwalk export html
```

writes `.explain/report.html` by default. The report is one portable file: it embeds
the document data, the Markdown-rendered explanations, the `@pierre/diffs` runtime that
parses and renders each exact diff, and all styles. It works offline as a local file
with JavaScript enabled and requests no CDN or external assets.

`text` and `summary` are rendered as Markdown, and inline HTML passes through, so a
diagram can sit exactly where the argument needs it. That makes authored text trusted
input: build reports only from documents you or a trusted agent authored.

Embed every image as an inline `<svg>` or a `data:` URI. A remote image URL renders in
the local file but is blocked on the hosted report, so the same document would look
different through a link.

## Hosted reports

```bash
diffwalk publish
```

materializes the same document `export html` renders, uploads it to the report service, and
prints an unlisted link. The service stores only that JSON and renders it with its own
shared renderer, so no HTML file is uploaded and every report reuses one cached copy of
the renderer instead of carrying its own.

Publishing is anonymous and unlisted, not private. The link cannot be guessed, but
anyone holding it can read the report without signing in. Treat the link as the secret,
and do not publish a document you would not hand to everyone who might receive it.

Publishing prints a revocation token once. Keep it: it is the only way to take that
report down.

```bash
diffwalk unpublish <report-id> --token <revocation-token>
```

A revocation token removes exactly one report and cannot touch another. Losing it means
the report stays published.

Reports are immutable. Publishing a revision creates a separate report at a separate
link, and the earlier link keeps serving the earlier report until it is revoked.

The trusted-text boundary from `diffwalk export html` still applies: authored markup is served
verbatim, so publish only what you or a trusted agent authored. The report origin is kept
powerless on purpose — no cookies, no inline scripts, no outbound connections — but that
contains bad markup rather than sanitizing it.

### Running the service

The service is one Cloudflare Worker with a private R2 bucket and its shared assets:

```bash
export CLOUDFLARE_API_TOKEN=...   # zone WAF and ruleset edit
export CLOUDFLARE_ZONE_ID=...
./infra/setup.sh                  # bucket, r2.dev off, WAF, rate limits
pnpm deploy
```

`wrangler.jsonc` owns the Worker, its Static Assets, and its R2 binding. `infra/setup.sh`
owns the zone-level settings wrangler does not manage, and re-running it is a no-op. Point
the CLI at another deployment with `--service` or `DIFFWALK_SERVICE_URL`.

## JSON export

`diffwalk export json` materializes capture plus explanations and writes the portable
ExplainDocument JSON (format version 1) for integrations or archiving. View, HTML export,
and publish do not require it; they validate and materialize directly from the authoring files.

## Captured data sensitivity

`capture.json` contains full file contents from your working tree and base commit.
Treat it as potentially sensitive and do not publish or send it without authorization.

## Agent skill

The repository includes an Agent Skill that teaches compatible coding agents how to
capture changes, author ordered sections, and validate with Diffwalk without
hand-writing patches. Its source lives at `.agents/skills/diffwalk`.

Link it into the shared user-level Agent Skills directory to make it available from
other repositories:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd)/.agents/skills/diffwalk" "$HOME/.agents/skills/diffwalk"
```

Agents that use another skill directory can point that directory at the same
`SKILL.md`. Start a new agent session after installing the skill so it can be
discovered.
