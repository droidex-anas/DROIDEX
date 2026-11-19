const { run, tryRun, sanitizeGitError } = require('./gitCommand.cjs');
const { repoRootOf, invalidateReads } = require('./gitRepository.cjs');
const {
  freshEnvironment,
  listRemotes,
  matchRemote,
  stripRemotePrefix,
} = require('./gitEnvironment.cjs');

const PUSH_TIMEOUT = 45000;
const FETCH_TIMEOUT = 30000;
// Commits run user pre-commit / commit-msg hooks (linters, formatters, tests),
// which routinely take far longer than the default read-command budget.
const COMMIT_TIMEOUT = 120000;

// Which remote a brand-new branch should publish to. Prefer an explicit
// push default, then `origin`, then the sole remote — never blindly assume
// `origin` exists, so repos cloned from `upstream` (or any other name) work.
async function defaultPushRemote(root) {
  const configured = await tryRun(root, ['config', '--get', 'remote.pushDefault']);
  if (configured) return configured;
  const remotes = await listRemotes(root);
  if (remotes.length === 0) return null;
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] ?? null;
}

async function commit(dir, { message, all = true } = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  if (!message || !message.trim()) return { ok: false, reason: 'empty_message' };
  try {
    if (all) await run(root, ['add', '-A'], { timeout: COMMIT_TIMEOUT });
    const staged = await tryRun(root, ['diff', '--cached', '--name-only']);
    // tryRun returns null on a git failure and '' when nothing is staged; only
    // the empty string means "nothing to commit" — a null is a real error (e.g.
    // a locked or corrupt index) and must not be reported as an empty staging.
    if (staged === null) {
      return { ok: false, reason: 'git_error', message: 'Failed to read staged files' };
    }
    if (!staged) return { ok: false, reason: 'nothing_to_commit' };
    await run(root, ['commit', '-m', message], { timeout: COMMIT_TIMEOUT });
    invalidateReads(root);
    const head = await tryRun(root, ['rev-parse', '--short', 'HEAD']);
    return { ok: true, head };
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

async function push(dir, { remote, branch, setUpstream = false, force = false } = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  const target = branch || (await tryRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
  if (!target || target === 'HEAD') return { ok: false, reason: 'detached' };
  // An explicit remote from IPC must be a configured remote name, not an
  // arbitrary URL (e.g. http://evil.com/repo.git) that could exfiltrate source
  // to an attacker-controlled server.
  if (remote) {
    const configured = await listRemotes(root);
    if (!configured.includes(remote))
      return { ok: false, reason: 'invalid_remote', message: `Unknown remote "${remote}"` };
  }
  // Honor the branch's configured upstream so a non-origin tracking ref is never
  // clobbered — but only when it names the *same* branch. A branch cut from
  // origin/main tracks origin/main as its base, and pushing `feature:main` there
  // would publish feature commits straight onto main.
  const upstream =
    setUpstream || remote || branch
      ? null
      : await tryRun(root, [
          'rev-parse',
          '--abbrev-ref',
          '--symbolic-full-name',
          `${target}@{upstream}`,
        ]);
  // The upstream names the *same* branch only when, after stripping its
  // (possibly slash-containing) remote name, the remainder equals the local
  // branch. Resolve the remote by configured name rather than the first slash so
  // a branch tracking `foo/bar/feature` on remote `foo/bar` is recognized and
  // pushed back to that remote instead of falling through to the default.
  const remotes = upstream ? await listRemotes(root) : [];
  const upstreamRemote = upstream ? matchRemote(upstream, remotes) : null;
  const sameNameUpstream = !!upstreamRemote && stripRemotePrefix(upstream, remotes) === target;
  const args = ['push'];
  // Publish under the branch's own name when the tracked upstream is really a
  // base ref (different name), and repoint tracking so later pushes stay correct.
  if (setUpstream || (upstream && !sameNameUpstream)) args.push('--set-upstream');
  if (force) args.push('--force-with-lease');
  const pushRemote = sameNameUpstream ? upstreamRemote : remote || (await defaultPushRemote(root));
  if (!pushRemote) {
    return { ok: false, reason: 'no_remote', message: 'No git remote configured' };
  }
  // Push a fully-qualified refspec after `--` so a branch literally named like a
  // flag (e.g. `--mirror`) can never be parsed as a push option and, say, mirror
  // every ref. The destination keeps the branch's own name on the remote.
  args.push('--', pushRemote, `refs/heads/${target}:refs/heads/${target}`);
  try {
    const output = await run(root, args, { timeout: PUSH_TIMEOUT });
    return { ok: true, output, environment: await freshEnvironment(root) };
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

// Best-effort refresh of remote-tracking refs so newly pushed branches appear
// without leaving the app. A no-remote repo is a success no-op; network/auth
// failures are reported but never throw, since callers fetch opportunistically.
async function fetchRemotes(dir) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  const remotes = await listRemotes(root);
  if (!remotes.length) return { ok: true };
  try {
    await run(root, ['fetch', '--all', '--prune'], { timeout: FETCH_TIMEOUT });
    invalidateReads(root);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

module.exports = { commit, push, fetchRemotes };
