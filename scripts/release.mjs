import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

if (process.argv[2] === '--resolve') {
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (pr.merged) resolveRelease(pr);
} else {
  prepareRelease(process.argv[2]);
}

function prepareRelease(version) {
  if (!isStable(version)) throw new Error('Usage: pnpm release <stable version>, e.g. pnpm release 0.1.8');
  if (git('status', '--porcelain')) throw new Error('Commit or stash working-tree changes before preparing a release.');
  run('gh', ['auth', 'status']);
  if (run('gh', ['api', 'user', '--jq', '.login']).trim() !== 'claudecafe') {
    throw new Error('GitHub CLI must be authenticated as claudecafe.');
  }
  run('git', ['fetch', 'origin', 'main']);
  const current = packageVersion('origin/main');
  if (!isStable(current) || compareVersions(version, current) <= 0) {
    throw new Error(`Release version must be newer than ${current}.`);
  }
  if (!git('show', 'origin/main:.github/workflows/publish.yml').includes('types: [closed]') ||
      !git('show', 'origin/main:.github/workflows/auto-merge.yml').includes("startsWith(github.event.pull_request.head.ref, 'release/')")) {
    throw new Error('Merge the PR-based release workflow into main before preparing a release.');
  }
  const tag = `v${version}`;
  const branch = `release/${tag}`;
  if (git('tag', '--list', tag) || git('branch', '--list', branch) ||
      git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/heads/${branch}`)) {
    throw new Error(`${tag} or ${branch} already exists.`);
  }

  run('git', ['switch', '-c', branch, 'origin/main']);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  pkg.version = version;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  run('git', ['add', 'package.json']);
  run('git', ['commit', '-m', `Prepare ${tag} for npm release`, '-m', 'Co-Authored-By: ことね <kotone@claudecafe.dev>']);
  run('git', ['tag', tag]);
  run('git', ['push', '--atomic', '--set-upstream', 'origin', branch, `refs/tags/${tag}`]);
  const body = `Release ${tag} to npm after CI passes and this PR is manually merged.\n\nUse **Create a merge commit**. Do not squash, rebase, or enable auto-merge: the version tag points to the original release commit.\n\nThe Publish workflow tests and publishes the tagged commit after merge.\n`;
  const url = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Release ${tag}`, '--body-file', '-'], body).trim();
  // Keep the release manual even if auto-merge was enabled externally during creation.
  run('gh', ['pr', 'merge', url, '--disable-auto']);
  console.log(`${url}\nAfter CI passes, manually use Create a merge commit to publish ${tag}.`);
}

function resolveRelease(pr) {
  const version = packageVersion(pr.head.sha);
  if (!isStable(version)) {
    throw new Error(`Expected a stable package version; received ${version}`);
  }
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  if (!git('tag', '--list', tag)) return;

  const commit = git('rev-parse', `${ref}^{commit}`);
  const parents = git('show', '-s', '--format=%P', pr.merge_commit_sha).split(' ');
  // A tag already present before this merge belongs to an earlier release.
  if (isAncestor(commit, parents[0])) return;
  if (parents.length !== 2 || parents[1] !== pr.head.sha) {
    throw new Error('Release PRs require Create a merge commit; squash and rebase are not supported.');
  }
  if (!isAncestor(commit, pr.head.sha) || !isAncestor(commit, pr.merge_commit_sha)) {
    throw new Error(`${tag} must point to a commit in the merged PR.`);
  }
  if (packageVersion(commit) !== version) {
    throw new Error(`${tag} does not match package.json at its commit.`);
  }
  console.log(commit);
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

function isAncestor(commit, descendant) {
  try {
    git('merge-base', '--is-ancestor', commit, descendant);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
