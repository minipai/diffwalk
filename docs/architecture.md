# Architecture

Diffwalk turns code changes into browser reports that present explanations and their
exact corresponding diffs in a deliberate order.

## Product decisions

- Authoring is split into two files inside `.diffwalk/<walkId>/`. `capture.json` is machine-owned capture data:
  a `captureId`, a `working-tree` `source` with a `from` commit endpoint and an ISO
  `capturedAt`, full old/new file snapshots, and derived `change-*` blocks. It never
  contains authored sections. `explanations.yaml` is the only author-edited file: it
  names the `captureId` it was authored against, carries a required `title` and an
  optional `summary`, and holds ordered sections of `{ title, steps[] }` where a step is
  `{ text?, changes[]? }` with at least one of the two.
- `captureId` identifies captured code contents, not the capture timestamp. It is a
  SHA-256 over a canonical serialization of the captured file snapshots (status, path,
  old path, old content, new content), so identical captures pair consistently while
  changed content produces a different identity.
- A walk ID combines the capture time in ISO 8601 basic UTC format with the first eight
  captureId characters, for example `20260831T063842Z-a7c9e4f2`. The full captureId
  remains the content identity; the shorter walk ID is only the human-facing directory
  name. `.diffwalk/current` stores the selected walk ID.
- `inspect` never overwrites an existing authored `explanations.yaml`. Unchanged contents
  reuse the current walk. Changed contents create a new timestamped walk, update current,
  and leave the earlier capture plus explanations pair intact.
- `explanations.yaml` is parsed as strict safe YAML 1.2 (the `yaml` package, core
  schema). Custom tags, duplicate keys, anchors, and aliases are rejected; YAML 1.1
  coercions (`yes`, `on`) stay plain strings; the result is validated by a strict Zod
  schema so numbers, booleans, and nulls are never coerced into strings.
- The final read model is an ordered document of `{ title, summary, sections: [{ title,
  steps: [{ text, diff? }] }] }`. Prose and diffs interleave inside a section because a
  step materializes its own patch from its own change IDs. Every captured change must be
  shown at least once; materialization rejects unknown IDs and unexplained changes.
- Showing a change in more than one step is allowed. Re-showing a hunk is how an author
  builds an argument, so `check` names the repeats and still succeeds; only an
  unexplained change fails. Completeness is the guarantee a reader relies on, not
  uniqueness.
- `check`, `view`, `export`, and `publish` read capture plus explanations, validate the
  pairing and assignments, and materialize exact patches in memory. No `document.json`
  is required at runtime; `export json` writes the portable ExplainDocument (format
  version 1) only for integrations and archiving.
- The agent should not hand-write unified patches for real working-tree changes.
  `diff` v9 identifies separate line-change blocks from complete old/new files;
  selected blocks are applied to the old content, then the same package creates a
  legal Git patch. Blocks can be explained separately even when the browser renders
  them inside the same visual hunk.
- Step `text` and the document `summary` render as Markdown with inline HTML passed
  through, so a diagram can sit exactly where the argument needs it. Authored text is
  trusted; containment is the report origin's Content Security Policy, not escaping.
  Images must be inline `<svg>` or `data:` URIs: a remote URL renders in the local file
  but is blocked on the hosted report.
- `diffwalk view` serves the report from an ephemeral loopback-only HTTP server and
  opens the default browser without writing a file. `diffwalk export html` writes the
  same report as one portable offline file. `diffwalk publish` uploads the same
  materialized document for hosted rendering, so all three delivery paths share one
  report shell and browser client.
- The HTML report is generated from the materialized document by `diffwalk export html`.
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

- `diffwalk publish` uploads the materialized version 1 ExplainDocument to the report
  service, which stores JSON only and renders `/r/:id` through the same shell the local
  report uses. The hosted page links the shared stylesheet and client instead of
  inlining them, so the renderer is deployed once and cached across every report.
  Publication is unlisted rather than private: the link is the only credential a reader
  needs. Each report mints a revocation token returned once and kept only as a SHA-256
  digest, so a lost token means the report stays published. The publish response carries
  no URL; the CLI builds the link from the service origin it dialed, because deriving it
  in the Worker would trust the request's `Host` header.

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
- `src/walk.ts`: timestamped walk IDs, per-walk paths, and the current-walk pointer.
- `src/cli.ts`: executable entry point for `inspect`, `changes`, `change`, `file`,
  `check`, `view`, `export`, `publish`, `unpublish`, and `help`.
- `src/view.ts`: loopback-only report preview server and default-browser launch.
- `src/report-patches.ts`: shared Pierre parse seam used by the generator, the browser
  client, and tests.
- `src/report-markdown.ts`: Markdown rendering with inline HTML passed through.
- `src/report.ts`: atomic report writes and client-bundle loading.
- `src/report-shell.ts`: the one report shell, embedded-data escaping, and shell styles,
  rendered with inlined assets for the offline file or linked assets for the hosted page.
- `src/publish.ts`: report service origin checks, publish credential lookup, and the
  publish and unpublish requests.
- `src/report-client.ts`: browser entry that mounts a `FileDiff` per file and switches
  unified/split through `setOptions`.
- `test/*.test.ts`: focused tests for schemas, capture identity, strict YAML parsing,
  materialization, Git capture, local preview, report schemas,
  Markdown escaping, embedded-data escaping, Pierre parse failures, CLI argument
  parsing, help, and atomic writes.
- `test/cli.test.ts`: end-to-end CLI tests in real temporary Git repositories for
  inspect file behavior (including preservation of authored explanations and stale
  pairing), inspection commands, validation, HTML/JSON exports, and rejection of the
  removed `build`, `report`, and draft workflows.
- `worker/index.ts`: the Cloudflare Worker that stores, renders, and revokes reports and
  sets the report origin's Content Security Policy, security headers, and caching.
- `worker/reports.ts`: report IDs, revocation tokens, token digests, constant-time secret
  comparison, and the bounded document size.
- `worker/build-assets.ts`: writes the shared stylesheet and client bundle into the Static
  Assets directory before deploy.
- `wrangler.jsonc`: the declarative Worker deployment: Static Assets, the R2 binding,
  routes, custom domain, and observability.
- `infra/setup.sh`: idempotent zone configuration Wrangler does not own: the R2 bucket,
  WAF managed rules, and rate limits.
- `worker/index.test.ts`: Worker route behavior against a stub bucket, covering
  authentication, validation, size limits, revocation, and error states.
- `test/publish.test.ts`: CLI publish and unpublish behavior against a stubbed fetch.
- `.agents/skills/diffwalk/SKILL.md`: teaches agents the authoring workflow and invariants.
