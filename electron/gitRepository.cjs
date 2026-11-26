const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { run, tryRun } = require('./gitCommand.cjs');

// Upper bound on repo-keyed caches (turn baselines, untracked scans) so a
// long-lived session that touches many repositories can't grow them unbounded.
const MAX_REPO_CACHE = 64;

function expandHome(value) {
  const str = String(value || '');
  if (str === '~') return os.homedir();
  if (str.startsWith('~/') || str.startsWith('~\\')) return path.join(os.homedir(), str.slice(2));
  return str;
}

async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function isWithin(base, target) {
  if (target === base) return true;
  // Avoid doubling the separator when `base` is a filesystem root (e.g. '/'):
  // base + path.sep would produce '//' and reject every sibling. A root already
  // ends with the separator, so reuse it as the prefix.
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return target.startsWith(prefix);
}

// Set a value in a repo-keyed cache, evicting the oldest entry once the cap is
// hit. Map preserves insertion order, so the first key is the oldest.
function setRepoCache(map, key, value) {
  if (!map.has(key) && map.size >= MAX_REPO_CACHE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

// Every IPC entry point resolves the repo root, and each poll cycle fires
// several of them in parallel, so an uncached resolution pays a stat plus a
// rev-parse per call. Cache briefly so one cycle resolves the root once; the
// short TTL keeps moved or newly initialized repos honest.
const repoRootCache = new Map();
const REPO_ROOT_TTL_MS = 5000;

async function repoRootOf(dir) {
  const key = expandHome(dir);
  if (!key) return null;
  const cached = repoRootCache.get(key);
  if (cached && Date.now() - cached.at < REPO_ROOT_TTL_MS) return cached.root;
  // Cache the in-flight promise, not just the answer: the poll cycle's IPC
  // calls start concurrently and would otherwise each pay their own rev-parse
  // before the first one lands. tryRun and isDirectory answer rather than throw,
  // so this promise never rejects.
  const root = (async () =>
    (await isDirectory(key))
      ? (await tryRun(key, ['rev-parse', '--show-toplevel'])) || null
      : null)();
  setRepoCache(repoRootCache, key, { root, at: Date.now() });
  return root;
}

// Short-lived cache for read-only queries (environment, branches, worktrees,
// diff stats, base-ref resolution), keyed by repo root + query. Every poll
// cycle fires several of these concurrently — often for the same repo from
// multiple subscribers — and each one costs a wave of git subprocesses. The
// in-flight promise is cached, so concurrent callers share one wave; the TTL
// is shorter than the poll interval, so consecutive cycles still see fresh
// data. Mutating actions invalidate the repo's entries immediately.
const READ_CACHE_TTL_MS = 2500;
const readCache = new Map();

// Tracks the resolved git common dir (the shared object/refs store that linked
// worktrees all point at) for each root that has had its environment queried.
// Populated as a side-effect of environmentOf, which already runs
// `git rev-parse --git-common-dir`. Used by invalidateReads to bust cached
// reads for sibling worktrees after a repo-wide mutation (branch create,
// checkout, commit, push, fetch, worktree add/remove).
const rootCommonDir = new Map();

function rememberCommonDir(root, commonDirRaw) {
  if (!root || !commonDirRaw) return;
  setRepoCache(rootCommonDir, root, path.resolve(root, commonDirRaw));
}

function cachedRead(root, name, fn) {
  const key = `${root}\u0000${name}`;
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) return hit.promise;
  const promise = fn();
  // A failed read must not be served for the rest of the TTL.
  promise.catch(() => readCache.delete(key));
  setRepoCache(readCache, key, { at: Date.now(), promise });
  return promise;
}

function invalidateReads(root) {
  if (!root) return;
  // Drop the mutating root's entries, then those of every linked-worktree
  // sibling sharing the same git common dir. A branch/worktree/commit mutation
  // changes repo-wide state (refs, the object store, the worktree list) that
  // each sibling has cached under its own root key; without cross-root
  // invalidation they would serve stale data until their independent TTL expires.
  const commonDir = rootCommonDir.get(root);
  const rootsToInvalidate = commonDir
    ? [root, ...siblingRootsSharingCommonDir(root, commonDir)]
    : [root];
  for (const target of rootsToInvalidate) {
    const prefix = `${target}\u0000`;
    for (const key of readCache.keys()) {
      if (key.startsWith(prefix)) readCache.delete(key);
    }
  }
}

// Roots known to share the given common dir, excluding the originating root.
// Derived from rootCommonDir, which is populated as each worktree's environment
// is queried. A sibling whose environment has never been polled will not appear
// here, but it also has no cached reads to invalidate.
function siblingRootsSharingCommonDir(originRoot, commonDir) {
  const siblings = [];
  for (const [siblingRoot, siblingCommonDir] of rootCommonDir) {
    if (siblingRoot !== originRoot && siblingCommonDir === commonDir) siblings.push(siblingRoot);
  }
  return siblings;
}

// Parse `git status --porcelain=v1 --branch`: the branch line, then one line
// per path with its index and worktree letters.
function parseStatusCounts(stdout) {
  let branch = null;
  let changed = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      branch = parseBranchLine(line.slice(3));
      continue;
    }
    const x = line[0];
    const y = line[1];
    if (x === '!' && y === '!') continue;
    changed++;
    if (x === '?' && y === '?') {
      untracked++;
      continue;
    }
    if (x !== ' ' && x !== '?') staged++;
    if (y !== ' ' && y !== '?') unstaged++;
  }
  return { branch, changed, staged, unstaged, untracked };
}

// The `## ` line of porcelain v1: "main...origin/main [ahead 1]", or an
// unborn branch, or a detached HEAD, which has no branch name.
function parseBranchLine(value) {
  const text = String(value || '').trim();
  if (text.startsWith('No commits yet on '))
    return text.slice('No commits yet on '.length).trim() || null;
  const branch = text.split('...')[0].trim();
  if (!branch || branch === 'HEAD' || branch.startsWith('HEAD ')) return null;
  return branch;
}

// Branch and change counts for the chat header's repository line, or null
// when `dir` is not a directory inside a repository.
async function repoStatus(dir) {
  const root = expandHome(dir);
  if (!root || !(await isDirectory(root))) return null;
  try {
    const [repoRoot, status] = await Promise.all([
      run(root, ['rev-parse', '--show-toplevel']),
      run(root, ['status', '--porcelain=v1', '--branch', '--untracked-files=all']),
    ]);
    return { repoRoot: repoRoot.trim() || null, ...parseStatusCounts(status) };
  } catch {
    return null;
  }
}

// The repository a project folder belongs to, or the folder itself outside one.
async function projectRoot(dir) {
  const root = expandHome(dir);
  if (!root) throw new Error('No project folder selected.');
  if (!(await isDirectory(root))) throw new Error('Project path is not a directory.');
  return (await tryRun(root, ['rev-parse', '--show-toplevel'])) || root;
}

module.exports = {
  expandHome,
  isWithin,
  repoRootOf,
  cachedRead,
  invalidateReads,
  rememberCommonDir,
  setRepoCache,
  repoStatus,
  projectRoot,
};
