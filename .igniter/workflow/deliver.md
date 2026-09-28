# Deliver

Deliver one owner-approved checkpoint to `main` through GitHub. The pull
request, required `Project check`, native rebase auto-merge, landed commit,
and production website deployments are one delivery; do not stop after opening
the pull request or merging it.

## Prepare

- Read and follow the repository instructions. Preserve the accepted checkpoint
  identity supplied by the work order.
- Fetch `origin/main` and rebase the exact ticket branch named in the work order
  onto it. If `node_modules` is absent, run `pnpm install --frozen-lockfile`.
  Run `pnpm check` and require a clean worktree. A rebase-only SHA change keeps
  the approval valid.
- Resolve a rebase conflict here only when the result preserves the accepted
  behavior. If resolution or a failed check requires a product behavior change,
  report the blocker so the ticket returns through Build and Acceptance.
- Push only the ticket branch named in the work order. Never push directly to
  `main`.

## Pull request and merge

- Before GitHub writes, run `gh auth status` and confirm the active account is
  `claudecafe`. Never run `gh auth switch`. For a single command that genuinely
  requires the owner's permissions, use
  `GH_TOKEN=$(gh auth token --user minipai) gh ...` for that command only.
- Create or update one non-draft pull request from the exact ticket branch to
  `main`. Put the ticket identifier in the title and summarize the accepted
  user benefit.
- Watch the repository's `Project check` and `Auto merge` workflows. Passing
  same-repository pull requests should enable native rebase auto-merge. If auto-
  merge is still not queued after the workflow succeeds, queue it explicitly
  with `gh pr merge --auto --rebase`.
- Stay with the pull request until GitHub reports it merged. Inspect failed job
  logs and retry only confirmed transient or infrastructure failures.
- If `main` advances before merge, rebase onto the new `origin/main`, rerun
  `pnpm check`, push with `--force-with-lease`, and watch the replacement check.

## Publish the websites

- After merge, fetch and verify the landed commit on `origin/main`. Deploy
  from that clean landed revision, never from unmerged feature changes.
- Use the Cloudflare and Wrangler skills. Read credentials from environment
  variables; keep authentication noninteractive and never print tokens.
- Run `pnpm run deploy` to build and deploy the `diffwalk-reports` Worker and
  shared report assets at `https://review.diffwalk.dev`.
- Run `pnpm exec wrangler deploy --config website/wrangler.jsonc` to deploy
  the `diffwalk-site` website at `https://diffwalk.dev`.
- Verify the homepage and an existing published review over HTTPS, including
  the delivered feature and its shared assets. Use read-only checks; do not
  create or delete production review data for deployment verification.
- Record both deployment version IDs, source commit, production URLs, and
  verification results. A failed deployment or verification leaves delivery
  incomplete; report the concrete blocker.

## Finish

After merge, fetch and verify that remote `main` contains the landed commit.
Record the pull request URL, accepted checkpoint, any rebased checkpoint,
successful check run, auto-merge result, landed commit, final lineage,
website deployment versions and verification, working-tree state, remaining
owner actions, and blockers or `none`.

Do not publish the npm package or run infrastructure provisioning unless the
owner separately authorizes it.
