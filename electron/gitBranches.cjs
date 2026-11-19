const { run, tryRun, sanitizeGitError } = require('./gitCommand.cjs');
const { repoRootOf, cachedRead } = require('./gitRepository.cjs');
const {
  freshEnvironment,
  listRemotes,
  matchRemote,
  rememberBase,
  resolvesToCommit,
} = require('./gitEnvironment.cjs');

// Parse `%(upstream:track)` like "[ahead 2, behind 1]" → { ahead, behind }.
function parseTrack(track) {
  const result = { ahead: 0, behind: 0 };
  if (!track) return result;
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  if (ahead) result.ahead = Number.parseInt(ahead[1], 10);
  if (behind) result.behind = Number.parseInt(behind[1], 10);
  return result;
}

async function branches(dir) {
  const root = await repoRootOf(dir);
  if (!root) return { current: null, detached: true, local: [], remote: [] };
  return cachedRead(root, 'branches', () => branchesOf(root));
}

async function branchesOf(root) {
  const sep = '\u0001';
  const [current, localOut, remoteOut, mergedOut] = await Promise.all([
    tryRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    tryRun(root, [
      'for-each-ref',
      `--format=%(refname:short)${sep}%(upstream:short)${sep}%(upstream:track)${sep}%(HEAD)${sep}%(committerdate:unix)${sep}%(contents:subject)`,
      'refs/heads',
    ]),
    tryRun(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    tryRun(root, ['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads']),
  ]);
  const merged = new Set(
    String(mergedOut || '')
      .split('\n')
      .filter(Boolean),
  );
  const local = String(localOut || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, track, headMark, date, subject] = line.split(sep);
      return {
        name,
        upstream: upstream || null,
        ...parseTrack(track),
        current: headMark === '*',
        committerDate: Number.parseInt(date, 10) || 0,
        subject: subject || '',
        merged: merged.has(name),
      };
    });
  const remote = String(remoteOut || '')
    .split('\n')
    // Drop the remote HEAD pointer: refs/remotes/origin/HEAD shortens to either
    // `origin/HEAD` or the bare remote name `origin` (no slash), and `git fetch`
    // now creates it by default. Real tracking branches are always `remote/branch`.
    .filter((name) => name && name.includes('/') && !name.endsWith('/HEAD'))
    .map((name) => ({ name }));
  return {
    current: current === 'HEAD' ? null : current,
    detached: current === 'HEAD',
    local,
    remote,
  };
}

function validBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  // A leading dash makes git parse the name as an option (e.g. `-D` would turn
  // `git branch -D <base>` into a branch deletion), so reject it outright.
  if (name.startsWith('-')) return false;
  if (name === '@' || name.endsWith('.') || name.includes('..') || name.includes('@{')) {
    return false;
  }
  // Forbidden characters per `git check-ref-format`: whitespace, the C0 control
  // characters and DEL (\x00-\x1f, \x7f), and ~ ^ : ? * [ \. Forward slashes ARE
  // allowed so hierarchical names like "feature/foo" work.
  // eslint-disable-next-line no-control-regex -- the control-char range is the point: branch names must reject C0 controls and DEL.
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  // Each slash-separated component must be non-empty (no leading/trailing slash
  // or "//"), must not begin with ".", and must not end with ".lock".
  return name
    .split('/')
    .every((seg) => seg.length > 0 && !seg.startsWith('.') && !seg.endsWith('.lock'));
}

async function createBranch(dir, { name, base, checkout = true } = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  if (!validBranchName(name))
    return { ok: false, reason: 'invalid_name', message: `Invalid branch name "${name ?? ''}"` };
  // Only fork from a base that resolves to a commit. In an unborn repo the
  // current branch (e.g. "main") exists as a symbolic ref but is not yet a valid
  // object, so passing it to git would fail; drop it and start the new branch
  // from the unborn HEAD instead.
  const baseRef = (await resolvesToCommit(root, base)) ? base : null;
  try {
    // `--` ends option parsing so a base ref can never be read as a flag.
    if (checkout) await run(root, ['switch', '-c', name, ...(baseRef ? ['--', baseRef] : [])]);
    else await run(root, ['branch', '--', name, ...(baseRef ? [baseRef] : [])]);
    await rememberBase(root, name, baseRef);
    return { ok: true, environment: await freshEnvironment(root) };
  } catch (err) {
    return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
  }
}

async function isDirty(root) {
  const status = await tryRun(root, ['status', '--porcelain']);
  return !!status && status.length > 0;
}

async function checkout(dir, { ref, allowDirty = false } = {}) {
  const root = await repoRootOf(dir);
  if (!root) return { ok: false, reason: 'not_a_repo' };
  if (!ref) return { ok: false, reason: 'invalid_name', message: 'No branch specified' };
  if (!allowDirty && (await isDirty(root))) return { ok: false, reason: 'dirty' };

  // An exact local branch wins over remote-prefix handling: a branch literally
  // named `origin/foo` must be checked out as-is, not treated as the remote ref
  // and collapsed to `foo`.
  const exactLocal = await tryRun(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]);
  if (exactLocal) {
    try {
      await run(root, ['switch', '--', ref]);
      return { ok: true, environment: await freshEnvironment(root) };
    } catch (err) {
      return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
    }
  }

  // When the caller picks a remote-tracking ref (e.g. `origin/feature`), switch
  // to the matching local branch, creating it as a tracking branch from that
  // exact remote when absent. This avoids the ambiguity of stripping the remote
  // prefix client-side, which breaks with multiple remotes sharing a name.
  if (ref.includes('/')) {
    // Resolve the owning remote by configured name (remotes may contain "/"),
    // requiring at least one branch segment after it.
    const remotes = await listRemotes(root);
    const matchedRemote = matchRemote(ref, remotes);
    if (matchedRemote && ref.length > matchedRemote.length + 1) {
      const local = ref.slice(matchedRemote.length + 1);
      const hasLocal = await tryRun(root, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${local}`,
      ]);
      try {
        if (hasLocal) {
          await run(root, ['switch', '--', local]);
          // The user picked a specific remote ref; if the existing local branch
          // tracks a different one, repoint its upstream to honor that choice.
          const current = await tryRun(root, [
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            `${local}@{upstream}`,
          ]);
          if (current !== ref) {
            await run(root, ['branch', `--set-upstream-to=${ref}`, '--', local]).catch(() => {});
          }
        } else {
          // Name the new branch after the part *following* the matched remote.
          // A bare `git switch --track <ref>` derives the name by stripping only
          // the first path component, which is wrong for slash-named remotes.
          await run(root, ['switch', '-c', local, '--track', '--', ref]);
        }
        return { ok: true, environment: await freshEnvironment(root) };
      } catch (err) {
        return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
      }
    }
  }

  try {
    await run(root, ['switch', '--', ref]);
    return { ok: true, environment: await freshEnvironment(root) };
  } catch (err) {
    // `switch` refuses non-branch refs, so detach for tags/sha. `--detach`
    // avoids `checkout`'s pathspec mode (`git checkout -- x` restores a file
    // named x instead of switching), and `--` keeps a ref that looks like a
    // flag (e.g. `-f`) from being parsed as an option and silently discarding
    // working-tree changes.
    try {
      await run(root, ['switch', '--detach', '--', ref]);
      return { ok: true, environment: await freshEnvironment(root) };
    } catch {
      return { ok: false, reason: 'git_error', message: sanitizeGitError(err.message) };
    }
  }
}

module.exports = { branches, validBranchName, createBranch, checkout };
