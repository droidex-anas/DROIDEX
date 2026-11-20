const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { run, runSoft, tryRun } = require('./gitCommand.cjs');
const { isWithin, repoRootOf, cachedRead, setRepoCache } = require('./gitRepository.cjs');
const { effectiveBaseRef } = require('./gitEnvironment.cjs');
const {
  scanUntracked,
  UNTRACKED_FILE_CAP,
  UNTRACKED_SCAN_CONCURRENCY,
} = require('./gitUntracked.cjs');

// The well-known SHA of git's empty tree, used as the left side when diffing an
// unborn branch (no HEAD) so first-turn work still shows up.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function untrackedAdditions(root) {
  const entries = await scanUntracked(root);
  let additions = 0;
  for (const e of entries) if (!e.binary) additions += e.additions;
  return { additions, files: entries.length };
}

// mode: 'worktree' (branch + uncommitted vs base), 'branch' (committed vs base),
// or 'uncommitted' (working tree vs HEAD).
async function diffStat(dir, options = {}) {
  const mode = ['worktree', 'branch', 'uncommitted'].includes(options.mode)
    ? options.mode
    : 'worktree';
  const root = await repoRootOf(dir);
  if (!root) return { mode, base: null, additions: 0, deletions: 0, files: 0 };
  return cachedRead(root, `diffStat:${mode}`, () => diffStatOf(root, mode));
}

async function diffStatOf(root, mode) {
  const defaultRef = await effectiveBaseRef(root);
  let base = null;
  if (defaultRef) base = await tryRun(root, ['merge-base', defaultRef, 'HEAD']);
  // An unborn repo (no commits yet) has no HEAD, so diffing against it errors;
  // compare against the empty tree so the current working contents of tracked
  // files (and untracked files) are counted, not just the staged copy.
  const hasHead = !!(await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']));

  if (mode === 'uncommitted') {
    const tracked = numstatTotals(
      await runSoft(root, ['diff', '--numstat', '-z', hasHead ? 'HEAD' : EMPTY_TREE]),
    );
    const untracked = await untrackedAdditions(root);
    return {
      mode,
      base: null,
      additions: tracked.additions + untracked.additions,
      deletions: tracked.deletions,
      files: tracked.files + untracked.files,
    };
  }

  if (mode === 'branch') {
    if (!base) return { mode, base: null, additions: 0, deletions: 0, files: 0 };
    const tracked = numstatTotals(
      await runSoft(root, ['diff', '--numstat', '-z', `${base}...HEAD`]),
    );
    return { mode, base, ...tracked };
  }

  // worktree total: everything since base, including the working tree.
  const range = base || (hasHead ? 'HEAD' : EMPTY_TREE);
  const tracked = numstatTotals(await runSoft(root, ['diff', '--numstat', '-z', range]));
  const untracked = await untrackedAdditions(root);
  return {
    mode,
    base,
    additions: tracked.additions + untracked.additions,
    deletions: tracked.deletions,
    files: tracked.files + untracked.files,
  };
}

// Sum `git diff --numstat -z` output into a totals object. Binary files report
// "-" counts and tally as one changed file with zero line deltas.
function numstatTotals(stdout) {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const { add, del } of parseNumstatZ(stdout)) {
    files += 1;
    if (add !== '-') additions += Number.parseInt(add, 10) || 0;
    if (del !== '-') deletions += Number.parseInt(del, 10) || 0;
  }
  return { additions, deletions, files };
}

// Mirror of DIFF_SCOPES in src/types/vcs.ts. The Electron process can't import
// that frontend module, so this list is kept in sync by hand; vcs.ts is the
// canonical source the UI and persisted state validate against.
const REVIEW_SCOPES = [
  'unstaged',
  'staged',
  'uncommitted',
  'commit',
  'branch',
  'worktree',
  'last_turn',
];

// Per-worktree baseline captured at the start of an agent turn so the
// "Last turn" scope can diff the working tree against that point in time.
// A new session starts under its clientRef, then adopts the entry under its
// appSessionId once creation succeeds. This keeps concurrent first turns in
// the same worktree isolated without a shared repo-level fallback.
const turnBaselines = new Map();

function turnBaselineKey(root, ownerId) {
  return `${root}\u0000${ownerId}`;
}

function normalizeScope(value) {
  return REVIEW_SCOPES.includes(value) ? value : 'unstaged';
}

function statusLabel(letter) {
  switch ((letter || '')[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type';
    default:
      return 'modified';
  }
}

// Split NUL-delimited git output (`-z`) into records, dropping the empty tail a
// trailing NUL leaves behind.
function splitNul(out) {
  const parts = String(out || '').split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// Parse `git diff --numstat -z`. A normal record is `added\tdeleted\tpath`; a
// rename/copy ends right after the counts (`added\tdeleted\t`) and is followed
// by two further records — the old path then the new path.
function parseNumstatZ(out) {
  const tokens = splitNul(out);
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const tab1 = tok.indexOf('\t');
    const tab2 = tab1 >= 0 ? tok.indexOf('\t', tab1 + 1) : -1;
    if (tab2 < 0) continue;
    const add = tok.slice(0, tab1);
    const del = tok.slice(tab1 + 1, tab2);
    let file = tok.slice(tab2 + 1);
    if (file === '') {
      file = tokens[i + 2] ?? tokens[i + 1] ?? '';
      i += 2;
    }
    rows.push({ add, del, path: file });
  }
  return rows;
}

// Parse `git diff --name-status -z`. A normal record is a `status` token then a
// `path` record; a rename/copy is `Rxx`/`Cxx` then old and new path records.
function parseNameStatusZ(out) {
  const tokens = splitNul(out);
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (!status) continue;
    if (/^[RC]/.test(status)) {
      rows.push({ status, from: tokens[i + 1] ?? '', path: tokens[i + 2] ?? '' });
      i += 2;
    } else {
      rows.push({ status, from: null, path: tokens[i + 1] ?? '' });
      i += 1;
    }
  }
  return rows;
}

function parseDiffFileList(numstatOut, rows) {
  // Both inputs are NUL-delimited (`-z`), so paths are emitted verbatim with no
  // shell-style quoting — this is what lets Review open files whose names would
  // otherwise be git-quoted (spaces, unicode, control chars). Raw metadata owns
  // statuses and post-rename paths.
  const files = [];
  const byPath = new Map();
  for (const { status, path: target } of rows) {
    if (!target) continue;
    const file = {
      path: target,
      status: statusLabel(status),
      additions: 0,
      deletions: 0,
      binary: false,
    };
    files.push(file);
    byPath.set(target, file);
  }
  for (const { add, del, path: target } of parseNumstatZ(numstatOut)) {
    if (!target) continue;
    const counts = {
      additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
      deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
      binary: add === '-' && del === '-',
    };
    const existing = byPath.get(target);
    if (existing) {
      existing.additions = counts.additions;
      existing.deletions = counts.deletions;
      existing.binary = counts.binary;
    } else {
      const file = { path: target, status: 'modified', ...counts };
      files.push(file);
      byPath.set(target, file);
    }
  }
  return files;
}

function parseRawZ(out) {
  const tokens = splitNul(out);
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const header = tokens[i];
    const status = header.slice(header.lastIndexOf(' ') + 1);
    const from = tokens[++i];
    const target = /^[RC]/.test(status) ? tokens[++i] : from;
    rows.push({ status, path: target, identity: `${header}\0${from}` });
  }
  return rows;
}

async function untrackedFileList(root) {
  return scanUntracked(root);
}

// Resolve a review scope to the `git diff` arguments, the base ref it compares
// against, and whether untracked working-tree files should be folded in.
async function scopeRange(root, scope, appSessionId) {
  if (scope === 'staged') return { args: ['--cached'], base: null, includeUntracked: false };
  if (scope === 'uncommitted') {
    // Everything not yet committed: working tree vs HEAD (staged + unstaged)
    // plus untracked files. Mirrors the Context panel's "Uncommitted" stat.
    const hasHead = await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return { args: [hasHead ? 'HEAD' : EMPTY_TREE], base: null, includeUntracked: true };
  }
  if (scope === 'commit') {
    const hasParent = await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD~1']);
    return {
      args: hasParent ? ['HEAD~1', 'HEAD'] : [EMPTY_TREE, 'HEAD'],
      base: hasParent ? 'HEAD~1' : null,
      includeUntracked: false,
    };
  }
  if (scope === 'branch' || scope === 'worktree') {
    const defaultRef = await effectiveBaseRef(root);
    const base = defaultRef ? await tryRun(root, ['merge-base', defaultRef, 'HEAD']) : null;
    if (scope === 'branch') {
      return { args: base ? [`${base}...HEAD`] : null, base, includeUntracked: false };
    }
    // Unborn repo: diff the whole working tree against the empty tree (mirrors
    // diffStat) so unstaged tracked edits show, not just the index.
    const hasHead = await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return { args: [base || (hasHead ? 'HEAD' : EMPTY_TREE)], base, includeUntracked: true };
  }
  if (scope === 'last_turn') {
    const entry = appSessionId ? turnBaselines.get(turnBaselineKey(root, appSessionId)) : undefined;
    if (!entry) {
      // No turn baseline for this session (app restarted, session restored
      // from history): approximate with HEAD for tracked work only. Folding
      // in untracked files without a turn-start snapshot would list every
      // preexisting untracked file as a turn change.
      return { args: ['HEAD'], base: 'HEAD', includeUntracked: false };
    }
    return {
      args: [entry.baseline],
      base: entry.baseline,
      includeUntracked: true,
      priorUntracked: entry.priorUntracked ?? null,
      priorUntrackedTruncated: !!entry.untrackedTruncated,
      priorUntrackedNames: entry.priorUntrackedNames ?? null,
    };
  }
  // unstaged (working tree vs index)
  return { args: [], base: null, includeUntracked: true };
}

async function diffFiles(dir, options = {}) {
  const scope = normalizeScope(options.mode);
  const root = await repoRootOf(dir);
  if (!root) return { mode: scope, base: null, files: [] };
  const {
    args,
    base,
    includeUntracked,
    priorUntracked,
    priorUntrackedTruncated,
    priorUntrackedNames,
  } = await scopeRange(root, scope, options.appSessionId);
  if (!args) return { mode: scope, base: null, files: [] };
  const [numstat, raw] = await Promise.all([
    runSoft(root, ['diff', ...args, '--numstat', '-z']).catch(() => ''),
    runSoft(root, ['diff', ...args, '--raw', '--no-abbrev', '-z']).catch(() => ''),
  ]);
  const rows = parseRawZ(raw);
  const identities = new Map(rows.map((row) => [row.path, row.identity]));
  const files = parseDiffFileList(numstat, rows);
  if (includeUntracked) {
    for (const u of await untrackedFileList(root)) {
      if (priorUntracked) {
        const priorSig = priorUntracked.get(u.path);
        // Hide files that predate the turn only when byte-for-byte unchanged;
        // surface preexisting untracked files the agent edited this turn.
        if (priorSig !== undefined && priorSig === u.sig) continue;
        // When the turn-start stat scan was truncated past the cap, a path
        // without a signature may still have existed at turn start. The full
        // name listing (uncapped) settles that: known-preexisting paths stay
        // hidden (unknowable whether edited), while genuinely new files still
        // surface. Without the listing (stale cache shape) stay conservative.
        if (
          priorUntrackedTruncated &&
          priorSig === undefined &&
          (!priorUntrackedNames || priorUntrackedNames.has(u.path))
        )
          continue;
      }
      if (!files.some((f) => f.path === u.path)) {
        files.push({
          path: u.path,
          status: 'untracked',
          additions: u.additions,
          deletions: 0,
          binary: u.binary,
        });
      }
    }
  }
  const readsWorktree = !['staged', 'branch', 'commit'].includes(scope);
  await Promise.all(
    files.map(async (file) => {
      // Raw metadata supplies both scoped blob IDs, modes and rename source.
      // Only working-tree scopes also depend on the live file's metadata.
      const hash = createHash('sha256').update(identities.get(file.path) ?? 'untracked');
      if (readsWorktree) {
        const stat = await fsp
          .lstat(path.join(root, file.path), { bigint: true })
          .catch(() => null);
        hash.update(stat ? `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}` : 'missing');
      }
      file.fingerprint = hash.digest('hex');
    }),
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { mode: scope, base: base || null, files };
}

// Resolve the pre-rename path for a file within a diff range. Uses the same
// detection as the file list (parseDiffFileList), so it only reports an old
// path when the list already classified the file as a rename/copy.
async function renameSource(root, args, file) {
  const out = await runSoft(root, ['diff', ...args, '--name-status', '-z']).catch(() => '');
  for (const row of parseNameStatusZ(out)) {
    if (row.from && row.path === file) return row.from;
  }
  return null;
}

async function fileDiff(dir, options = {}) {
  const scope = normalizeScope(options.mode);
  const file = options.path;
  const root = await repoRootOf(dir);
  if (!root || !file) return { path: file || null, diff: '', binary: false };
  // Diff paths are repo-relative; anything resolving outside the root (absolute
  // path, ../ escape) would let the --no-index fallback read arbitrary files.
  if (!isWithin(root, path.resolve(root, file))) return { path: file, diff: '', binary: false };
  const { args, includeUntracked } = await scopeRange(root, scope, options.appSessionId);
  if (!args) return { path: file, diff: '', binary: false };
  const ws = options.ignoreWhitespace ? ['-w'] : [];
  // A rename restricted to just the new path can't be paired with its deleted
  // source, so git would render the whole file as newly added. Diff both paths
  // with rename detection on so the rename/edit hunk shows instead.
  const renameOld = await renameSource(root, args, file);
  const pathSpec = renameOld ? ['-M', '--', renameOld, file] : ['--', file];
  let out = await runSoft(root, ['diff', ...ws, ...args, ...pathSpec]);
  // Untracked files (incl. preexisting ones the agent edited) have no tree-side
  // to diff against, so render their full current content via --no-index. Gate
  // this on the file actually being untracked: with -w a tracked file can yield
  // an empty diff (whitespace-only edits), which must not be shown as brand new.
  if (!out && includeUntracked) {
    const tracked = await run(root, ['ls-files', '--error-unmatch', '--', file])
      .then(() => true)
      .catch(() => false);
    if (!tracked) {
      out = await runSoft(root, ['diff', ...ws, '--no-index', '--', os.devNull, file]);
    }
  }
  return { path: file, diff: out, binary: /^Binary files /m.test(out) };
}

async function fileSignature(root, rel) {
  try {
    const s = await fsp.stat(path.join(root, rel));
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
}

async function markTurnStart(dir, ownerId) {
  const root = await repoRootOf(dir);
  if (!root || !ownerId) return { ok: false };
  const baselinePromise = (async () => {
    let value = await tryRun(root, ['stash', 'create']);
    if (!value) value = await tryRun(root, ['rev-parse', 'HEAD']);
    // Unborn repo (no commits yet): `stash create` and `rev-parse HEAD` both
    // fail, so capture the current index as a tree object instead. Diffing
    // against it makes the agent's first-turn work show once it commits.
    if (!value) value = await tryRun(root, ['write-tree']);
    return value;
  })();
  // `git stash create` captures tracked changes but omits untracked files, while
  // the last-turn diff folds in every current untracked file. Snapshot each
  // preexisting untracked path with a size+mtime signature so files that predate
  // the turn are hidden, while edits the agent makes to them still surface.
  // Cap like scanUntracked does: past the cap the turn diff won't surface the
  // files anyway, and stat-ing an unbounded listing (node_modules and the like)
  // would stall the turn-start hook.
  // The tracked baseline and untracked listing are independent snapshots of
  // the same turn-start state. Capture them concurrently so repositories with
  // large tracked and untracked trees do not add both scan times to prompt
  // delivery latency.
  const [baseline, priorListingOutput] = await Promise.all([
    baselinePromise,
    tryRun(root, ['ls-files', '--others', '--exclude-standard']),
  ]);
  const priorListing = String(priorListingOutput || '')
    .split('\n')
    .filter(Boolean);
  const priorNames = priorListing.slice(0, UNTRACKED_FILE_CAP);
  // When the untracked listing exceeded the cap, the signature map can't answer
  // "did this path predate the turn?" for entries beyond it. Keep the full name
  // listing too (names are cheap; only stat-ing is capped) so the last-turn
  // diff can still tell "existed at turn start" from "created this turn".
  const untrackedTruncated = priorListing.length > UNTRACKED_FILE_CAP;
  const priorUntrackedNames = untrackedTruncated ? new Set(priorListing) : null;
  // Same bounded worker pool as scanUntracked: this runs on the prompt-send
  // path, where stat-ing up to the cap sequentially would stall the turn start,
  // while unbounded Promise.all could exhaust file descriptors on huge repos.
  const sigs = new Array(priorNames.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(UNTRACKED_SCAN_CONCURRENCY, priorNames.length) }, async () => {
      while (cursor < priorNames.length) {
        const i = cursor++;
        sigs[i] = await fileSignature(root, priorNames[i]);
      }
    }),
  );
  const priorUntracked = new Map(priorNames.map((rel, i) => [rel, sigs[i]]));
  if (baseline)
    setRepoCache(turnBaselines, turnBaselineKey(root, ownerId), {
      baseline,
      priorUntracked,
      untrackedTruncated,
      priorUntrackedNames,
    });
  return { ok: !!baseline, baseline: baseline || null };
}

async function adoptTurnBaseline(dir, clientRef, appSessionId) {
  const root = await repoRootOf(dir);
  if (!root || !clientRef || !appSessionId) return { ok: false };
  const sourceKey = turnBaselineKey(root, clientRef);
  const entry = turnBaselines.get(sourceKey);
  if (!entry) return { ok: false };
  turnBaselines.delete(sourceKey);
  setRepoCache(turnBaselines, turnBaselineKey(root, appSessionId), entry);
  return { ok: true };
}

// Every change against HEAD as one patch, untracked files included.
async function workingTreeDiff(root) {
  const parts = [await run(root, ['diff', 'HEAD', '--'])];
  const untracked = (await run(root, ['ls-files', '--others', '--exclude-standard']))
    .split(/\r?\n/)
    .filter(Boolean);
  for (const file of untracked) {
    parts.push(await runSoft(root, ['diff', '--no-index', '--', os.devNull, file]));
  }
  return parts.filter(Boolean).join('\n');
}

module.exports = {
  diffStat,
  diffFiles,
  fileDiff,
  markTurnStart,
  adoptTurnBaseline,
  workingTreeDiff,
};
