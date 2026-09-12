# Build

Implement one ticket in the prepared worktree. Read and follow the repository
instructions before writing. The work order supplies the request, acceptance
criteria, checkpoint context, and any failures returned from Acceptance.

- Inspect the existing branch and working-tree diff before editing. Preserve
  unrelated work and continue from an existing correction attempt.
- Make the smallest complete production change for the ticket.
- Add deterministic `*.test.ts` or `*.test.tsx` coverage for each new behavior,
  state, or protocol. Keep tests with the established suite.
- Use pnpm for package scripts. If `node_modules` is absent, run
  `pnpm install --frozen-lockfile`. Run `pnpm check` before the checkpoint
  commit; it is the repository's required typecheck, build, and test gate.
- Exercise every acceptance criterion through the public CLI, rendered report,
  or Worker API named by the criterion. Build the CLI first and invoke the
  generated `dist/diffwalk.js` rather than treating source-level tests as
  acceptance evidence.
- Never mutate the live review service, deploy the Worker, or publish the npm
  package during Build unless the owner explicitly authorizes that external
  action. Publishing the required Diffwalk walkthrough below is the sole
  standing exception.
- After implementation and self-acceptance, ask one subagent to inspect the
  current diff once for concrete correctness, security, and test-gap findings.
  Fix relevant in-scope findings and rerun affected checks. Do not start a
  second review pass.
- Inspect the final diff and create one checkpoint commit with a concise English
  message, following the repository's commit authorship instructions. Fold
  review fixes and check fixes into that feature commit.
- Create a Diffwalk walkthrough for the final committed change before handoff:
  run `diffwalk inspect --from <checkpoint-context> --to HEAD`, inspect the
  capture only through `diffwalk changes`, `diffwalk change`, and
  `diffwalk file`, then author ordered explanations that show every captured
  change. Run `diffwalk check`, publish the walkthrough, and include its URL in
  the Build result. Do not comment on Linear yourself; the Global Commander
  verifies the URL and adds it to the ticket before submitting the Build
  receipt.
- Do not push. Only Deliver updates the remote branch after Acceptance passes and
  the owner approves the accepted checkpoint.

Report the checkpoint commit, every required check and its result, one
self-acceptance result per criterion, reproduction commands, evidence paths,
the one-pass subagent findings and fixes, the published Diffwalk URL, and
unresolved concerns.
