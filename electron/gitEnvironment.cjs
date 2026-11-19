const path = require('node:path');
const { run, tryRun } = require('./gitCommand.cjs');
const {
  repoRootOf,
  cachedRead,
  invalidateReads,
  rememberCommonDir,
} = require('./gitRepository.cjs');

// Parse the `# branch.*` headers of `git status --porcelain=v2 --branch`. One
// subprocess yields the branch name (even on an unborn branch, where rev-parse
// fails), the upstream and the ahead/behind counts, replacing four separate
// rev-parse/rev-list calls per environment refresh.
function parseStatusBranch(stdout) {
  const out = { head: null, upstream: null, ahead: 0, behind: 0 };
  for (const line of String(stdout || '').split('\n')) {
    if (!line.startsWith('#')) break; // file entries follow the headers
    if (!line.startsWith('# branch.')) continue;
    const rest = line.slice('# branch.'.length);
    if (rest.startsWith('head ')) out.head = rest.slice(5);
    else if (rest.startsWith('upstream ')) out.upstream = rest.slice(9);
    else if (rest.startsWith('ab ')) {
      const m = rest.match(/^ab \+(\d+) -(\d+)$/);
      if (m) {
        out.ahead = Number.parseInt(m[1], 10) || 0;
        out.behind = Number.parseInt(m[2], 10) || 0;
      }
    }
  }
  return out;
}

async function defaultBaseRef(root, remote = 'origin') {
  if (!remote) return null;
  const head = await tryRun(root, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
  if (head) return head.replace('refs/remotes/', '');
  for (const candidate of [`${remote}/main`, `${remote}/master`]) {
    if (await tryRun(root, ['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return null;
}

async function listRemotes(root) {
  return String((await tryRun(root, ['remote'])) || '')
    .split('\n')
    .filter(Boolean);
}

// The remote to read base/GitHub metadata from. Prefer `origin`, otherwise the
// sole/first remote, so repos cloned as `upstream` (or any name) still resolve.
function pickPrimaryRemote(remotes) {
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] || null;
}

async function resolveBaseRef(root) {
  return defaultBaseRef(root, pickPrimaryRemote(await listRemotes(root)));
}

// Remote names may themselves contain "/" (e.g. "foo/bar"), so resolve the
// owning remote by testing each configured name and preferring the longest
// match, rather than assuming the remote is the text before the first slash.
function matchRemote(ref, remotes) {
  if (!ref) return null;
  return (
    (remotes || [])
      .filter((r) => ref === r || ref.startsWith(`${r}/`))
      .sort((a, b) => b.length - a.length)[0] || null
  );
}

// Drop the leading "<remote>/" from a remote-tracking ref (e.g. "origin/main"
// -> "main"), leaving local refs and bare remote names untouched.
function stripRemotePrefix(ref, remotes) {
  const r = matchRemote(ref, remotes);
  return r && ref.length > r.length + 1 ? ref.slice(r.length + 1) : ref;
}

// A base ref is "remote" when it lives under a configured remote (e.g.
// "origin/main"); otherwise it is a local branch (e.g. "dev").
function baseKindOf(baseRef, remotes) {
  if (!baseRef) return null;
  return matchRemote(baseRef, remotes) ? 'remote' : 'local';
}

// Git does not record the local branch a new branch forked from, so we persist
// the user's chosen base in repo config and read it back for display.
function storedBase(root, branch) {
  if (!branch) return Promise.resolve(null);
  return tryRun(root, ['config', `branch.${branch}.droidcontrolBase`]);
}

function storedBaseCommit(root, branch) {
  if (!branch) return Promise.resolve(null);
  return tryRun(root, ['config', `branch.${branch}.droidcontrolBaseCommit`]);
}

// The ref the current branch was forked from: the user's chosen base (persisted
// at creation), with its immutable commit preferred for diffs. Keeping the
// selected ref separately lets the UI still display "main" or "origin/main",
// while the comparison remains useful after that ref advances through a merge.
function effectiveBaseRef(root) {
  return cachedRead(root, 'baseRef', async () => {
    const branch = await tryRun(root, ['symbolic-ref', '--short', 'HEAD']);
    const forkCommit = branch ? await storedBaseCommit(root, branch) : null;
    if (forkCommit && (await tryRun(root, ['rev-parse', '--verify', '--quiet', forkCommit])))
      return forkCommit;
    const stored = branch ? await storedBase(root, branch) : null;
    if (stored && (await tryRun(root, ['rev-parse', '--verify', '--quiet', stored]))) return stored;
    return resolveBaseRef(root);
  });
}

async function rememberBase(root, branch, base) {
  if (!branch || !base) return;
  try {
    const commit = await tryRun(root, ['rev-parse', '--verify', `${base}^{commit}`]);
    await run(root, ['config', `branch.${branch}.droidcontrolBase`, base]);
    if (commit) await run(root, ['config', `branch.${branch}.droidcontrolBaseCommit`, commit]);
  } catch {
    // non-fatal: base display simply falls back to the upstream ref
  }
}

// True only when `ref` resolves to a real commit object. Guards against passing
// an unborn branch name (valid as a symbolic ref but not yet an object) or any
// other unresolvable ref to git as a fork base.
async function resolvesToCommit(root, ref) {
  if (!ref) return false;
  return !!(await tryRun(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
}

async function environment(dir) {
  const root = await repoRootOf(dir);
  if (!root) return { isRepo: false };
  return cachedRead(root, 'environment', () => environmentOf(root));
}

async function environmentOf(root) {
  const [statusOut, head, dirs, remotes] = await Promise.all([
    // -uno: only the `# branch.*` headers matter here, so skip the untracked
    // scan and keep the output small on repos with large ignored-adjacent trees.
    tryRun(root, ['status', '--porcelain=v2', '--branch', '-uno']),
    tryRun(root, ['rev-parse', '--short', 'HEAD']),
    tryRun(root, ['rev-parse', '--git-common-dir', '--git-dir']),
    listRemotes(root),
  ]);
  // `branch.head` resolves the branch name even before the first commit
  // (unborn branch); only a real detached HEAD reports "(detached)".
  const status = parseStatusBranch(statusOut);
  const detached = !status.head || status.head === '(detached)';
  const branchName = detached ? null : status.head;
  const { ahead, behind } = status;
  const [commonDir, gitDir] = String(dirs || '').split('\n');
  // Record the common dir so invalidateReads can cross-invalidate sibling
  // worktrees after a repo-wide mutation. Both values are relative to root
  // (or absolute), so resolve against root for a stable comparison key.
  rememberCommonDir(root, commonDir);
  const primaryRemote = pickPrimaryRemote(remotes);
  const [remoteUrl, defaultRef, storedBaseState, upstreamResolved] = await Promise.all([
    primaryRemote ? tryRun(root, ['remote', 'get-url', primaryRemote]) : null,
    defaultBaseRef(root, primaryRemote),
    // The stored base and its verification are inherently sequential (verify
    // needs the ref), so chain them inside this wave rather than adding one.
    detached
      ? null
      : storedBase(root, branchName).then(async (ref) => ({
          ref,
          verified: ref ? await tryRun(root, ['rev-parse', '--verify', '--quiet', ref]) : null,
        })),
    // A configured upstream whose remote-tracking ref was deleted (e.g. the
    // branch was removed on the remote but the local config remains) still
    // appears in porcelain v2's `# branch.upstream`. Verify it resolves so the
    // UI stops reporting tracking, letting the next Push repair it.
    status.upstream ? tryRun(root, ['rev-parse', '--verify', '--quiet', status.upstream]) : null,
  ]);
  const storedBaseRef = storedBaseState?.ref ?? null;
  const storedBaseVerified = storedBaseState?.verified ?? null;
  // Only report an upstream when its remote-tracking ref still resolves: porcelain
  // v2 emits `# branch.upstream` from config even after the ref is deleted.
  const upstream = upstreamResolved ? status.upstream : null;
  // The ref this branch forks from and is diffed against (mirrors
  // effectiveBaseRef): its verified stored base, otherwise the default branch
  // ref. Upstream is the push target (often the branch's own remote ref), not a
  // base, so it is intentionally not used here.
  const base = storedBaseRef && storedBaseVerified ? storedBaseRef : defaultRef;
  const isLinkedWorktree =
    !!commonDir && !!gitDir && path.resolve(root, commonDir) !== path.resolve(root, gitDir);
  return {
    isRepo: true,
    repoRoot: root,
    worktreePath: root,
    isLinkedWorktree,
    branch: detached ? null : branchName,
    detached,
    head: head || null,
    upstream: upstream || null,
    base: base || null,
    baseKind: baseKindOf(base, remotes),
    ahead,
    behind,
    defaultBranch: defaultRef ? stripRemotePrefix(defaultRef, remotes) : null,
    defaultRef,
    remotes,
    // http(s) remote URLs may embed userinfo before the host; strip it before
    // handing the URL to the renderer. scp-style ssh remotes (git@host:path)
    // are left alone since "git" is not a secret. The userinfo class is greedy
    // up to the LAST '@' before the host so secrets that themselves contain
    // '@' are fully stripped.
    remoteUrl: remoteUrl ? remoteUrl.replace(/^(\w+:\/\/)[^/]+@/, '$1') : null,
    // Anchor to the URL's host boundary so `github.com` only matches as the real
    // host (`https://github.com/…`, `git@github.com:…`), never embedded in an
    // arbitrary host such as `github.com.evil.com` or `evil.com/github.com`.
    isGitHub: !!remoteUrl && /(?:^|@|\/\/)github\.com[/:]/i.test(remoteUrl),
  };
}

// Mutating actions return a freshly computed environment so the caller's UI
// updates without waiting for the next poll; drop the repo's cached reads
// first so this (and every concurrent poll) recomputes.
function freshEnvironment(root) {
  invalidateReads(root);
  return environment(root);
}

module.exports = {
  environment,
  freshEnvironment,
  listRemotes,
  matchRemote,
  stripRemotePrefix,
  effectiveBaseRef,
  rememberBase,
  resolvesToCommit,
};
