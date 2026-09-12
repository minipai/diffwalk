# Releasing to npm

**Pushing a `v*` tag triggers a public npm release.** The
[publish workflow](../.github/workflows/publish.yml) checks that the tag matches the
stable version in `package.json`, runs `pnpm check`, and publishes through OIDC.
The existing `prepack` script builds the package before publishing. There is no
manual npm approval step; pushing a branch or creating a local tag does not publish.

To release:

1. Update `package.json` to the next stable version and merge the change through
   a pull request after CI passes.
2. Update your local `main` and tag that release commit. For example, if the merged
   package version is `0.1.8`:

   ```bash
   git switch main
   git pull --ff-only origin main
   git tag v0.1.8
   git push origin v0.1.8
   ```

3. Check the Publish run in GitHub Actions and confirm the version on npm.

Use a new version for each release. Prerelease versions such as `0.1.8-beta.1`
are rejected by this workflow.
