const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { run, tryRun, sanitizeGitError } = require('./gitCommand.cjs');
const {
  expandHome,
  isWithin,
  repoRootOf,
  cachedRead,
  invalidateReads,
} = require('./gitRepository.cjs');
const { rememberBase, resolvesToCommit } = require('./gitEnvironment.cjs');
const { validBranchName } = require('./gitBranches.cjs');

const WORKTREE_ADD_TIMEOUT = 45000;

// Parse `git worktree list --porcelain` into structured entries.
function parseWorktrees(stdout, currentRoot) {
  const blocks = String(stdout || '')
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block, index) => {
    const entry = {
      path: null,
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      isMain: index === 0,
      isCurrent: false,
    };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD '))
        entry.head = line.slice('HEAD '.length).trim().slice(0, 12);
      else if (line.startsWith('branch '))
        entry.branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
      else if (line === 'bare') entry.bare = true;
      else if (line === 'detached') entry.detached = true;
      else if (line.startsWith('locked')) entry.locked = true;
    }
    if (entry.path && currentRoot && path.resolve(entry.path) === path.resolve(currentRoot))
      entry.isCurrent = true;
    return entry;
  });
}

async function worktrees(dir) {
  const root = await repoRootOf(dir);
  if (!root) return [];
  return cachedRead(root, 'worktrees', async () => {
    const out = await tryRun(root, ['worktree', 'list', '--porcelain']);
    return parseWorktrees(out, root);
  });
}

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function defaultWorktreeLocation(root, branch) {
  return path.join(root, '.worktrees', sanitizeSegment(branch) || 'worktree');
}

function detachedWorktreeLocation(root, name) {
  return path.join(defaultWorktreeLocation(root, name), path.basename(root));
}

// Default worktrees live under `<repo>/.worktrees`. Add that path to the repo's
// local exclude file (not a tracked `.gitignore`) so creating one does not leave
// the original checkout dirty and trip the dirty-tree guards / status counts.
async function ensureDefaultWorktreeIgnored(root) {
  try {
    const rel = await tryRun(root, ['rev-parse', '--git-common-dir']);
    if (!rel) return;
    const excludePath = path.join(path.resolve(root, rel), 'info', 'exclude');
    let contents = '';
    try {
      contents = await fsp.readFile(excludePath, 'utf8');
    } catch {
      // exclude file may not exist yet
    }
    if (/^\/?\.worktrees\/?$/m.test(contents)) return;
    await fsp.mkdir(path.dirname(excludePath), { recursive: true });
    const prefix = contents && !contents.endsWith('\n') ? '\n' : '';
    await fsp.appendFile(excludePath, `${prefix}/.worktrees/\n`);
  } catch {
    // best effort: never block worktree creation on the ignore write
  }
}

// A custom worktree location is user-typed, so keep it inside places a checkout
// plausibly lives: the repo itself, its parent (sibling worktrees), or the home
// directory. Anything else (e.g. /etc, /tmp planted by a hostile renderer) is
// rejected, as is nesting inside the .git dir where it would corrupt the repo.
function allowedWorktreeTarget(root, target) {
  const resolved = path.resolve(target);
  if (isWithin(path.join(root, '.git'), resolved)) return false;
  return (
    isWithin(root, resolved) ||
    isWithin(path.dirname(root), resolved) ||
    isWithin(os.homedir(), resolved)
  );
}

async function createWorktree(dir, options = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  const detached = options.detached === true;
  const branch = options.branch;
  const base = options.base;
  const newBranch = options.newBranch ?? false;
  const location = options.location;
  const worktreeName = detached ? sanitizeSegment(options.name) : branch;
  if (detached) {
    if (!worktreeName || worktreeName === '.' || worktreeName === '..')
      return { ok: false, reason: 'invalid_name', message: 'Invalid worktree name' };
    if (!(await resolvesToCommit(root, base)))
      return { ok: false, reason: 'invalid_name', message: `Invalid base ref "${base ?? ''}"` };
  } else if (!validBranchName(branch)) {
    return { ok: false, reason: 'invalid_name', message: `Invalid branch name "${branch ?? ''}"` };
  }
  // A relative custom location must resolve against the repo root (where git
  // creates it), not the Electron process cwd — otherwise the existence check,
  // the actual creation, and the returned path could all refer to different
  // directories, missing collisions and starting the chat at the wrong cwd.
  let target = location
    ? path.resolve(root, expandHome(location))
    : detached
      ? detachedWorktreeLocation(root, worktreeName)
      : defaultWorktreeLocation(root, worktreeName);
  if (location) {
    if (!allowedWorktreeTarget(root, target))
      return {
        ok: false,
        reason: 'invalid_location',
        message: 'Worktree location must be inside the repo, next to it, or in your home folder',
      };
    if (fs.existsSync(target)) return { ok: false, reason: 'exists', path: target };
  } else {
    // Default-location worktrees auto-suffix so a second worktree for the same
    // branch (or a leftover directory) never collides — keeps the flow workable.
    for (let n = 2; fs.existsSync(target); n++) {
      target = detached
        ? detachedWorktreeLocation(root, `${worktreeName}-${String(n)}`)
        : `${defaultWorktreeLocation(root, worktreeName)}-${String(n)}`;
    }
  }
  try {
    // Ignore `.worktrees/` whenever the target lives there, even if the caller
    // passed the default path explicitly as `location` — otherwise it would
    // surface as untracked in the original checkout.
    const defaultRoot = path.join(root, '.worktrees') + path.sep;
    if (path.resolve(target).startsWith(defaultRoot)) await ensureDefaultWorktreeIgnored(root);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    // Only fork a new worktree branch from a base that resolves to a commit
    // (mirrors createBranch); an unborn base ref would fail.
    const baseRef = newBranch && (await resolvesToCommit(root, base)) ? base : null;
    // `--` ends option parsing so a user-editable target path (e.g. a relative
    // `-wt`) or ref can never be read as a git option.
    const args = detached
      ? ['worktree', 'add', '--detach', '--', target, base]
      : newBranch
        ? ['worktree', 'add', '-b', branch, '--', target, ...(baseRef ? [baseRef] : [])]
        : ['worktree', 'add', '--', target, branch];
    await run(root, args, { timeout: WORKTREE_ADD_TIMEOUT });
    if (newBranch) await rememberBase(root, branch, baseRef);
    // When forking from a remote-tracking ref (e.g. `upstream/foo`), set up
    // upstream tracking so push/pull targets the right remote without manual
    // configuration. `git worktree add -b` doesn't do this automatically.
    if (newBranch && baseRef) {
      try {
        // tryRun never throws, so gate on its result: only a real
        // remote-tracking ref should become the new branch's upstream.
        const isRemoteRef = await tryRun(root, [
          'rev-parse',
          '--verify',
          `refs/remotes/${baseRef}`,
        ]);
        if (isRemoteRef) await run(root, ['branch', '--set-upstream-to', baseRef, '--', branch]);
      } catch {
        // upstream config failed; worktree is usable without it
      }
    }
    invalidateReads(root);
    return detached ? { ok: true, path: target } : { ok: true, path: target, branch };
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

async function removeWorktree(dir, { path: target, force = false, deleteBranch = false } = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  if (!target)
    return { ok: false, reason: 'invalid_worktree', message: 'No worktree path specified' };
  // Resolve the target against the repo root (matching how createWorktree
  // resolves relative locations) and validate it is a registered linked
  // worktree — never the main worktree — so a compromised renderer cannot
  // remove arbitrary directories or wipe the primary checkout.
  const resolvedTarget = path.resolve(root, expandHome(target));
  const registered = await worktrees(root);
  const match = registered.find((wt) => wt.path && path.resolve(wt.path) === resolvedTarget);
  if (!match)
    return {
      ok: false,
      reason: 'invalid_worktree',
      message: 'Path is not a registered worktree of this repository',
    };
  if (match.isMain)
    return {
      ok: false,
      reason: 'invalid_worktree',
      message: 'Cannot remove the main worktree',
    };
  try {
    await run(root, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', resolvedTarget]);
    invalidateReads(root);
    if (!deleteBranch || !match.branch) return { ok: true, branch: match.branch };
    try {
      // `-d` is intentionally non-forcing: Git refuses to delete a branch that
      // is not merged into the main checkout's current branch.
      await run(root, ['branch', '-d', '--', match.branch]);
      invalidateReads(root);
      return { ok: true, branch: match.branch, branchDeleted: true };
    } catch (err) {
      return {
        ok: true,
        branch: match.branch,
        branchDeleted: false,
        message: `Worktree removed, but branch was kept: ${sanitizeGitError(err.message)}`,
      };
    }
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

module.exports = {
  worktrees,
  sanitizeSegment,
  allowedWorktreeTarget,
  createWorktree,
  removeWorktree,
};
