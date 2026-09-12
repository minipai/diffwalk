# Releasing to npm

From a clean working tree, prepare a new stable version:

```bash
pnpm release 0.1.8
```

This creates a version commit on a branch from the latest `origin/main`, pushes
that branch, and opens a PR with auto-merge disabled. It does not create a tag or
publish anything.

After CI passes, merge the PR manually. Then use its PR number to publish:

```bash
pnpm release:publish 123
```

This checks that PR #123 is merged into `main`, verifies its version, and pushes a
version tag pointing to that PR's merged commit, even if `main` has advanced.
Pushing the tag triggers the [Publish workflow](../.github/workflows/publish.yml),
which checks, builds, and publishes the package to npm. Check the Actions run and
npm version afterward.

Use a new version for each release. Prereleases are not supported.
