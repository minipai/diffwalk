# Releasing to npm

From a clean working tree, run:

```bash
pnpm release 0.1.8
```

The script branches from the latest `origin/main`, updates `package.json`, creates
and tags the version commit, pushes the branch and tag, and opens a release PR.
Use a new stable version; prereleases are not supported.

After CI passes, manually select **Create a merge commit**. Do not squash, rebase,
or enable auto-merge: the tag must keep pointing to the original PR commit.
Release branches (`release/*`) are excluded from automatic merging.

Pushing the tag does not publish. Merging the release PR triggers the
[publish workflow](../.github/workflows/publish.yml), which verifies that the tagged
commit was preserved, tests and builds that commit, and publishes it directly to
npm. Check the Publish run and the version on npm after merging.
