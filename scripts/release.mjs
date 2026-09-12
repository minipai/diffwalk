import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length === 2) {
  console.log(`Usage:
  pnpm release <version>          Prepare a version PR, e.g. pnpm release 0.1.8
  pnpm release:publish <number>   Tag a merged PR, e.g. pnpm release:publish 123

Start with a clean working tree and a new stable version (no prereleases).
Preparation branches from the latest origin/main, updates package.json, commits,
pushes the branch, and opens a PR with auto-merge disabled. It does not create a tag.

After CI passes, merge the PR manually, then run release:publish with its PR number.
This tags that PR's merged commit, even if main has advanced. Pushing the tag
triggers GitHub Actions to check, build, and publish to npm. Check the Publish run
and the npm version afterward.`);
} else if (process.argv[2] === '--publish') {
  publishRelease(process.argv[3]);
} else {
  prepareRelease(process.argv[2]);
}

function prepareRelease(version) {
  validateReleaseVersion(version);
  validateCleanTree('preparing a release');
  validateGitHubAccount();
  run('git', ['fetch', 'origin', 'main']);
  const current = packageVersion('origin/main');
  validateNewerVersion(version, current);
  const tag = `v${version}`;
  const branch = `release/${tag}`;
  validateNewReleaseBranch(tag, branch);

  run('git', ['switch', '-c', branch, 'origin/main']);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  pkg.version = version;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  run('git', ['add', 'package.json']);
  run('git', ['commit', '-m', `Prepare ${tag} for npm release`, '-m', 'Co-Authored-By: ことね <kotone@claudecafe.dev>']);
  run('git', ['push', '--set-upstream', 'origin', branch]);
  const body = `Prepare ${tag} for npm release.\n\nAfter CI passes, merge this PR manually. Do not enable auto-merge. After merging, run pnpm release:publish <PR number> to tag the merged commit and trigger npm publishing.\n`;
  const url = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Release ${tag}`, '--body-file', '-'], body).trim();
  // Keep the release manual even if auto-merge was enabled externally during creation.
  run('gh', ['pr', 'merge', url, '--disable-auto']);
  console.log(`${url}\nAfter CI passes and this PR is merged, run pnpm release:publish <PR number>.`);
}

function publishRelease(prNumber) {
  validatePrNumber(prNumber);
  validateCleanTree('publishing');
  run('gh', ['auth', 'status']);
  const pr = JSON.parse(run('gh', ['pr', 'view', prNumber, '--json', 'state,baseRefName,headRefName,mergeCommit']));
  validateMergedReleasePr(pr);
  const version = pr.headRefName.replace(/^release\/v/, '');
  validateReleaseBranch(pr.headRefName, version);
  run('git', ['fetch', 'origin', 'main']);
  const commit = pr.mergeCommit.oid;
  validateReleaseCommit(commit, version);
  const tag = `v${version}`;
  validateNewReleaseTag(tag);
  run('git', ['tag', tag, commit]);
  run('git', ['push', 'origin', `refs/tags/${tag}`]);
  console.log(`Pushed ${tag} at ${commit}. Check the Publish workflow in GitHub Actions.`);
}

function validateReleaseVersion(version) {
  if (!isStable(version)) throw new Error('Usage: pnpm release <stable version>, e.g. pnpm release 0.1.8');
}

function validateCleanTree(operation) {
  if (git('status', '--porcelain')) throw new Error(`Commit or stash working-tree changes before ${operation}.`);
}

function validateGitHubAccount() {
  run('gh', ['auth', 'status']);
  if (run('gh', ['api', 'user', '--jq', '.login']).trim() !== 'claudecafe') {
    throw new Error('GitHub CLI must be authenticated as claudecafe.');
  }
}

function validateNewerVersion(version, current) {
  if (!isStable(current) || compareVersions(version, current) <= 0) {
    throw new Error(`Release version must be newer than ${current}.`);
  }
}

function validateNewReleaseBranch(tag, branch) {
  if (git('tag', '--list', tag) || git('branch', '--list', branch) ||
      git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/heads/${branch}`)) {
    throw new Error(`${tag} or ${branch} already exists.`);
  }
}

function validatePrNumber(prNumber) {
  if (!/^[1-9]\d*$/.test(prNumber ?? '')) throw new Error('Usage: pnpm release:publish <PR number>');
}

function validateMergedReleasePr(pr) {
  if (pr.state !== 'MERGED' || pr.baseRefName !== 'main' || !pr.mergeCommit?.oid) {
    throw new Error('The release PR must be merged into main before publishing.');
  }
}

function validateReleaseBranch(branch, version) {
  if (!branch.startsWith('release/v') || !isStable(version)) {
    throw new Error('Expected a release/v<version> PR branch.');
  }
}

function validateReleaseCommit(commit, version) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('GitHub returned an invalid merge commit.');
  git('merge-base', '--is-ancestor', commit, 'origin/main');
  if (packageVersion(commit) !== version) throw new Error('The merged package version does not match the release branch.');
}

function validateNewReleaseTag(tag) {
  if (git('tag', '--list', tag) || git('ls-remote', 'origin', `refs/tags/${tag}`)) {
    throw new Error(`${tag} already exists.`);
  }
}

function isStable(version) {
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

function compareVersions(left, right) {
  const other = right.split('.').map(BigInt);
  for (const [index, value] of left.split('.').map(BigInt).entries()) {
    if (value !== other[index]) return value > other[index] ? 1 : -1;
  }
  return 0;
}

function run(command, args, input) {
  return execFileSync(command, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

function packageVersion(commit) {
  return JSON.parse(git('show', `${commit}:package.json`)).version;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
