type DiffOpType = 'add' | 'del' | 'ctx';
export interface DiffOp {
  type: DiffOpType;
  text: string;
}
export interface FileChange {
  path: string;
  verb: 'edit' | 'create' | 'patch';
  ops: DiffOp[];
  added: number;
  removed: number;
}

export const MAX_DIFF_CARDS_PER_COMMIT = 50;

export function nextDiffCardCount(currentCount: number, totalCount: number): number {
  return Math.min(totalCount, currentCount + MAX_DIFF_CARDS_PER_COMMIT);
}

export interface DiffDisclosureState {
  revealedCount: number;
  mountedCount: number;
}

function minimumDiffCardCount(totalCount: number): number {
  return Math.min(totalCount, MAX_DIFF_CARDS_PER_COMMIT);
}

function revealedDiffCardCount(state: DiffDisclosureState, totalCount: number): number {
  return Math.min(totalCount, Math.max(state.revealedCount, minimumDiffCardCount(totalCount)));
}

export function createDiffDisclosure(totalCount: number): DiffDisclosureState {
  const count = minimumDiffCardCount(totalCount);
  return { revealedCount: count, mountedCount: count };
}

export function reopenDiffDisclosure(
  state: DiffDisclosureState,
  totalCount: number,
): DiffDisclosureState {
  const revealedCount = revealedDiffCardCount(state, totalCount);
  return {
    revealedCount,
    mountedCount: Math.min(revealedCount, MAX_DIFF_CARDS_PER_COMMIT),
  };
}

export function revealNextDiffCards(
  state: DiffDisclosureState,
  totalCount: number,
): DiffDisclosureState {
  return {
    revealedCount: nextDiffCardCount(revealedDiffCardCount(state, totalCount), totalCount),
    mountedCount: Math.min(state.mountedCount, totalCount),
  };
}

export function mountNextRevealedDiffCards(
  state: DiffDisclosureState,
  totalCount: number,
): DiffDisclosureState {
  const revealedCount = revealedDiffCardCount(state, totalCount);
  return {
    revealedCount,
    mountedCount: nextDiffCardCount(Math.min(state.mountedCount, revealedCount), revealedCount),
  };
}

const EDIT_TOOLS = [
  'edit',
  'multiedit',
  'multi_edit',
  'str_replace',
  'apply_patch',
  'create',
  'write',
];

export function isEditTool(name: string | undefined): boolean {
  const lower = name?.toLowerCase() ?? '';
  return (
    EDIT_TOOLS.some((t) => lower === t) ||
    lower.includes('edit') ||
    lower.includes('patch') ||
    lower.includes('write') ||
    lower.includes('str_replace')
  );
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

// Line-level LCS diff. Guarded against very large inputs.
function lineDiff(oldStr: string, newStr: string): DiffOp[] {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) {
    return [
      ...a.map((t) => ({ type: 'del' as const, text: t })),
      ...b.map((t) => ({ type: 'add' as const, text: t })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] });
  while (j < m) ops.push({ type: 'add', text: b[j++] });
  return ops;
}

// apply_patch / unified-diff bodies carry the file path in their header lines
// (`*** Update File: x`, `+++ b/x`), which the arg keys don't expose. Recover it
// so edits show the real filename instead of the generic "file" fallback.
function pathFromPatch(patch: string): string | undefined {
  // Prefer the new-file path (`+++ b/x`); fall back to the old-file path
  // (`--- a/x`) for delete-only diffs where the new side is `/dev/null`.
  let fromOld: string | undefined;
  for (const line of patch.split('\n')) {
    const star = /^\*\*\* (?:Update|Add|Delete|Move to) File:\s*(.+?)\s*$/.exec(line);
    if (star) return star[1];
    const plus = /^\+\+\+ (?:[ab]\/)?(.+?)\s*$/.exec(line);
    if (plus && plus[1] !== '/dev/null') return plus[1];
    const minus = /^--- (?:[ab]\/)?(.+?)\s*$/.exec(line);
    if (minus && minus[1] !== '/dev/null' && fromOld === undefined) fromOld = minus[1];
  }
  return fromOld;
}

// Header lines name files and hunks; every other line is content. A unified
// hunk says how many old and new lines it holds, and until they are read no
// line is a header: an added "++i" arrives as "+++i" and a removed "-- x" as
// "--- x". An apply_patch hunk gives no count and runs to the next file.
function parsePatch(patch: string): DiffOp[] {
  const ops: DiffOp[] = [];
  let owed = 0;
  // A patch ends with a newline; the empty string after it is not a line.
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      // A count left out is one line.
      const [, oldLines = '1', newLines = '1'] = hunk;
      owed = Number(oldLines) + Number(newLines);
      continue;
    }
    if (line.startsWith('@@')) {
      owed = Infinity;
      continue;
    }
    if (line.startsWith('*** ') || line.startsWith('diff ')) {
      // An added file's lines follow its apply_patch header without a hunk.
      owed = line.startsWith('*** Add File:') ? Infinity : 0;
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (owed === 0 && /^(index |\+\+\+ |--- )/.test(line)) continue;
    if (line.startsWith('+')) ops.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) ops.push({ type: 'del', text: line.slice(1) });
    else ops.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
    // A context line is one old line and one new one.
    owed = Math.max(0, owed - (line.startsWith('+') || line.startsWith('-') ? 1 : 2));
  }
  return ops;
}

// Extraction is cached on the tool-args object: transcript events are immutable
// once ingested (the store replaces growing snapshots instead of mutating), so
// one args object always yields the same change. The feed scans each edit
// several times per projection and re-projects on every update, and this makes
// every repeat free. WeakMap entries die with the transcript events that carry
// them, so the cache never retains a released window.
// The result depends only on the args, never on which edit tool name was used.
const fileChangeCache = new WeakMap<object, FileChange | null>();

export function extractFileChange(toolName?: string, args?: unknown): FileChange | null {
  if (!toolName) return null;
  if (!isEditTool(toolName)) return null;
  if (!args || typeof args !== 'object') return computeFileChange(args);
  const cached = fileChangeCache.get(args);
  if (cached !== undefined) return cached;
  const extracted = computeFileChange(args);
  fileChangeCache.set(args, extracted);
  return extracted;
}

// A change whose diff lines are computed on first access and memoized, so
// projecting a feed never pays the quadratic LCS cost for edits whose cards
// are never mounted or opened. The computation inputs are resolved strings
// captured at extraction time — exactly what an eager diff would have used —
// and they are released once the ops exist.
function lazyFileChange(
  path: string,
  verb: FileChange['verb'],
  computeOps: () => DiffOp[],
): FileChange {
  interface Resolved {
    ops: DiffOp[];
    added: number;
    removed: number;
  }
  // The pending closure is dropped in the same pass that resolves, so a
  // materialized change never retains the edit strings it was computed from.
  let state: { kind: 'pending'; compute: () => DiffOp[] } | ({ kind: 'resolved' } & Resolved) = {
    kind: 'pending',
    compute: computeOps,
  };
  const materialize = (): Resolved => {
    if (state.kind === 'pending') {
      const ops = state.compute();
      let added = 0;
      let removed = 0;
      for (const op of ops) {
        if (op.type === 'add') added++;
        else if (op.type === 'del') removed++;
      }
      state = { kind: 'resolved', ops, added, removed };
    }
    return state;
  };
  return {
    path,
    verb,
    get ops() {
      return materialize().ops;
    },
    get added() {
      return materialize().added;
    },
    get removed() {
      return materialize().removed;
    },
  };
}

function computeFileChange(args: unknown): FileChange | null {
  const a: Record<string, unknown> =
    args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const argPath = firstString(a, [
    'path',
    'file_path',
    'filePath',
    'file',
    'target_file',
    'filename',
  ]);

  const patch =
    firstString(a, ['patch', 'diff', 'input']) ?? (typeof args === 'string' ? args : undefined);
  if (patch && /(^|\n)[+-]/.test(patch)) {
    const ops = parsePatch(patch);
    return finalize(argPath ?? pathFromPatch(patch) ?? 'file', 'patch', ops);
  }

  const path = argPath ?? 'file';

  if (Array.isArray(a.edits)) {
    const pairs = (a.edits as Record<string, unknown>[]).map(
      (e) =>
        [
          firstString(e, ['old_string', 'old_str', 'oldText', 'old']) ?? '',
          firstString(e, ['new_string', 'new_str', 'newText', 'new']) ?? '',
        ] as const,
    );
    // A diff of identical strings is all context lines, which `finalize` drops:
    // the emptiness check is exact without running the LCS.
    if (pairs.every(([oldText, newText]) => oldText === newText)) return null;
    return lazyFileChange(path, 'edit', () =>
      pairs.flatMap(([oldText, newText]) => lineDiff(oldText, newText)),
    );
  }

  const oldS = firstString(a, ['old_string', 'old_str', 'oldText', 'old']);
  const newS = firstString(a, ['new_string', 'new_str', 'newText', 'new']);
  if (oldS !== undefined || newS !== undefined) {
    const oldText = oldS ?? '';
    const newText = newS ?? '';
    if (oldText === newText) return null;
    return lazyFileChange(path, 'edit', () => lineDiff(oldText, newText));
  }

  const content = firstString(a, ['content', 'contents', 'text']);
  if (content !== undefined)
    return lazyFileChange(
      path,
      'create',
      // One add per line, so a create is never empty — not even for "".
      () => content.split('\n').map((t) => ({ type: 'add' as const, text: t })),
    );

  return null;
}

function finalize(path: string, verb: FileChange['verb'], ops: DiffOp[]): FileChange | null {
  const added = ops.filter((o) => o.type === 'add').length;
  const removed = ops.filter((o) => o.type === 'del').length;
  if (added === 0 && removed === 0) return null;
  return { path, verb, ops, added, removed };
}
