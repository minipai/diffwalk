# Review

Independently test the committed checkpoint through diffwalk's public product
surface. This is black-box acceptance, not source or diff review.

## Inputs

Use only the feature request, observable acceptance criteria, exact checkpoint,
public CLI, rendered report or Worker API, safe test data, repository run rules,
and any failed criteria explicitly returned for recheck. Do not inspect source
files, Git history, Git diffs, the Build plan, file list, implementation notes,
or Builder conclusions.

The generic work-order instruction to inspect the worktree diff and branch log
does not apply to Review. Keep this stage black-box.

## Environment

- Work only in the prepared ticket worktree and the scratch location named in
  the work order. Never alter product code, configuration, or Git history.
- If `node_modules` is absent, run `pnpm install --frozen-lockfile`. Run
  `pnpm build` to materialize the ignored distribution artifacts when the
  public CLI is not already present. Invoke it as `node dist/diffwalk.js`.
- Create disposable Git repositories and authored walk data under the worker's
  scratch directory. Do not reuse the diffwalk repository as acceptance input.
- For CLI criteria, capture the exact command, integer exit code, and relevant
  stdout and stderr.
- For Worker API criteria, run `pnpm build:worker`, start
  `pnpm exec wrangler dev --local --ip 127.0.0.1 --port <unused-port>`, and use
  non-secret data. Exercise `publish` and `unpublish` only against that exact
  loopback origin with `--service`; stop Wrangler after capturing the results.
- For browser criteria, run `node dist/diffwalk.js view` against the disposable
  walk and use the `agent-browser` skill on the loopback URL it prints. Save
  screenshots or recordings beside the result file and visually inspect them
  before reporting.
- Do not use the hosted review service, `pnpm deploy`, Wrangler remote or
  deployment commands, or npm publication. Those mutate external services and
  require separate owner authorization.

## Acceptance

Exercise each criterion from the supplied checkpoint and report exactly one
PASS or FAIL result for it. Each result must contain the criterion, expected and
actual behavior, reproduction steps, and submit-compatible evidence: either an
absolute HTTP(S) URL or a command transcript with the exact command, integer
exit code, stdout, and stderr. Local screenshot and recording paths are
supplementary evidence only. Record environment or tool failures separately;
do not turn them into product failures.

Never fix a finding. On a correction attempt, recheck only the failed criteria
plus a short smoke test of previously passing critical behavior.

Return the checkpoint, environment details, per-criterion results, evidence
locations, smoke-test result when applicable, environment failures, and the
overall PASS or FAIL verdict.
