// The source panel's state, as a pure reducer. The sidecar owns canonical
// source; this module owns the one thing it cannot: what the user has typed and
// has not saved yet.
//
// Spec §4: "A dirty buffer is local editor state; saving uses the revision
// captured when editing began. A conflict preserves that buffer and offers
// comparison/reapply, never silent overwrite." So a revision that lands while a
// buffer is dirty never replaces it — both texts are held, theirs in `files`
// and the user's in the buffer, until the user keeps one. Buffers are keyed by
// frame as well as by path, so moving to another frame and back cannot lose an
// edit either.
//
// The wire's `SourceFiles` record becomes a map on the way in: a path is user
// and agent data, and a map keeps a lookup honest about missing keys.

import type { CanvasBuildState, CanvasDiagnostic, SourceFiles } from './protocol';

/** One file the user has edited, and the revision the edit began from. */
export interface SourceBuffer {
  /** What the user has typed. */
  draft: string;
  /** The revision this edit began from; Save sends it as `expectedRevisionId`. */
  baseRevisionId: string | null;
  /** The file at `baseRevisionId`, so Revert and a conflict can compare. */
  baseText: string;
  /**
   * A newer revision that landed while this buffer was dirty. `text` is the file
   * in that revision, or null when the revision deleted it.
   */
  conflict: { revisionId: string; text: string | null } | null;
}

/** One frame's source, as the panel holds it. */
export interface FrameSource {
  /** The revision `files` were read at, or null for a frame with no source. */
  revisionId: string | null;
  /** Canonical source at `revisionId`, exactly as the sidecar answered. */
  files: ReadonlyMap<string, string>;
  activePath: string | null;
  /** Only the paths the user has edited. */
  buffers: ReadonlyMap<string, SourceBuffer>;
  /** The build diagnostics for `revisionId`. */
  diagnostics: readonly CanvasDiagnostic[];
}

export interface CanvasSourceState {
  /** The frame whose source is open, or null while the panel is closed. */
  openDesignId: string | null;
  /** Keyed by design ID. A frame the user leaves keeps its unsaved buffers. */
  frames: ReadonlyMap<string, FrameSource>;
  /** True from Save until its receipt or its failure. */
  saving: boolean;
  /** The last save failure, in the sidecar's own recovery wording. */
  saveError: string | null;
}

const EMPTY_FRAME: FrameSource = {
  revisionId: null,
  files: new Map(),
  activePath: null,
  buffers: new Map(),
  diagnostics: [],
};

export const emptyCanvasSourceState: CanvasSourceState = {
  openDesignId: null,
  frames: new Map(),
  saving: false,
  saveError: null,
};

export type CanvasSourceAction =
  /** The toolbar's Source action, and the panel slot's only way in. */
  | { type: 'openSourcePanel'; designId: string }
  /** Closes the panel and discards every buffer it was holding. */
  | { type: 'closeSourcePanel' }
  /**
   * One revision's source tree: the first read of a frame, and every revision
   * that lands on it afterwards. Both are the same event here — a clean frame
   * follows the head, and a dirty one conflicts.
   */
  | {
      type: 'loaded';
      designId: string;
      revisionId: string | null;
      files: SourceFiles;
      diagnostics: readonly CanvasDiagnostic[];
    }
  | { type: 'selectFile'; path: string }
  | { type: 'edit'; path: string; text: string }
  /** Drops one buffer and shows the file as the revision has it. */
  | { type: 'revert'; path: string }
  /** Rebases the buffer onto the revision that superseded it, keeping the draft. */
  | { type: 'keepMine'; path: string }
  /** Drops the draft for the revision's own text. */
  | { type: 'takeTheirs'; path: string }
  | { type: 'saving' }
  /** A write's receipt, with the files it carried. */
  | { type: 'saved'; designId: string; revisionId: string; files: SourceFiles }
  | { type: 'saveFailed'; message: string };

export function canvasSourceReducer(
  state: CanvasSourceState,
  action: CanvasSourceAction,
): CanvasSourceState {
  switch (action.type) {
    case 'openSourcePanel':
      return { ...state, openDesignId: action.designId, saveError: null };
    case 'closeSourcePanel':
      return emptyCanvasSourceState;
    case 'loaded':
      return withFrame(state, action.designId, (frame) => load(frame, action));
    case 'selectFile':
      return onOpenFrame(state, (frame) =>
        frame.files.has(action.path) || frame.buffers.has(action.path)
          ? { ...frame, activePath: action.path }
          : frame,
      );
    case 'edit':
      return onOpenFrame(state, (frame) => edit(frame, action.path, action.text));
    case 'revert':
      return onOpenFrame(state, (frame) => drop(frame, action.path));
    case 'keepMine':
      return onOpenFrame(state, (frame) => resolve(frame, action.path, 'mine'));
    case 'takeTheirs':
      return onOpenFrame(state, (frame) => resolve(frame, action.path, 'theirs'));
    case 'saving':
      return { ...state, saving: true, saveError: null };
    case 'saved':
      return {
        ...withFrame(state, action.designId, (frame) =>
          save(frame, action.revisionId, toMap(action.files)),
        ),
        saving: false,
        saveError: null,
      };
    case 'saveFailed':
      return { ...state, saving: false, saveError: action.message };
  }
}

/** The open frame's source, or an empty one while the panel has no frame. */
export function openFrameSource(state: CanvasSourceState): FrameSource {
  if (state.openDesignId === null) return EMPTY_FRAME;
  return state.frames.get(state.openDesignId) ?? EMPTY_FRAME;
}

function withFrame(
  state: CanvasSourceState,
  designId: string,
  change: (frame: FrameSource) => FrameSource,
): CanvasSourceState {
  const held = state.frames.get(designId) ?? EMPTY_FRAME;
  const next = change(held);
  if (next === held) return state;
  return { ...state, frames: new Map(state.frames).set(designId, next) };
}

function onOpenFrame(
  state: CanvasSourceState,
  change: (frame: FrameSource) => FrameSource,
): CanvasSourceState {
  if (state.openDesignId === null) return state;
  return withFrame(state, state.openDesignId, change);
}

/**
 * Takes one revision's tree. A clean buffer has nothing to lose and follows the
 * head. A dirty one becomes a conflict carrying the revision's own text, and
 * the draft is left exactly as the user typed it.
 */
function load(
  frame: FrameSource,
  loaded: Extract<CanvasSourceAction, { type: 'loaded' }>,
): FrameSource {
  // A read that answers for the revision this frame already holds moves nothing
  // but the diagnostics, which a rebuild of the same source does change.
  if (loaded.revisionId === frame.revisionId) return { ...frame, diagnostics: loaded.diagnostics };
  const files = toMap(loaded.files);
  const buffers = new Map<string, SourceBuffer>();
  for (const [path, buffer] of frame.buffers) {
    // A clean buffer has nothing to lose and follows the head.
    if (buffer.draft === buffer.baseText && !buffer.conflict) continue;
    const text = files.get(path) ?? null;
    // The revision left this file alone, so the edit still applies and only its
    // base moves: a Save against the revision it was typed on would be refused
    // for a change somewhere else in the tree.
    if (text === buffer.baseText || loaded.revisionId === null)
      buffers.set(path, { ...buffer, baseRevisionId: loaded.revisionId });
    else buffers.set(path, { ...buffer, conflict: { revisionId: loaded.revisionId, text } });
  }
  return {
    revisionId: loaded.revisionId,
    files,
    activePath: activePath(frame.activePath, files, buffers),
    buffers,
    diagnostics: loaded.diagnostics,
  };
}

/** Keeps the open file across a revision, falling back to the first one. */
function activePath(
  current: string | null,
  files: ReadonlyMap<string, string>,
  buffers: ReadonlyMap<string, SourceBuffer>,
): string | null {
  if (current !== null && (files.has(current) || buffers.has(current))) return current;
  return listPaths(files, buffers)[0] ?? null;
}

function edit(frame: FrameSource, path: string, text: string): FrameSource {
  const held = frame.buffers.get(path);
  const buffer: SourceBuffer = held
    ? { ...held, draft: text }
    : {
        draft: text,
        baseRevisionId: frame.revisionId,
        baseText: frame.files.get(path) ?? '',
        conflict: null,
      };
  return { ...frame, buffers: new Map(frame.buffers).set(path, buffer) };
}

function drop(frame: FrameSource, path: string): FrameSource {
  if (!frame.buffers.has(path)) return frame;
  const buffers = new Map(frame.buffers);
  buffers.delete(path);
  return { ...frame, buffers };
}

/**
 * Settles one conflict. Keeping the draft rebases it onto the revision that
 * superseded it, so the next Save carries that revision and is accepted instead
 * of rejected again; the agent's text stays in its own revision either way.
 */
function resolve(frame: FrameSource, path: string, choice: 'mine' | 'theirs'): FrameSource {
  const conflict = frame.buffers.get(path)?.conflict;
  if (!conflict) return frame;
  if (choice === 'theirs') return drop(frame, path);
  const rebased: SourceBuffer = {
    draft: sourceText(frame, path),
    baseRevisionId: conflict.revisionId,
    baseText: conflict.text ?? '',
    conflict: null,
  };
  return { ...frame, buffers: new Map(frame.buffers).set(path, rebased) };
}

/**
 * Settles the write this panel just made. The buffers it carried are saved and
 * drop out; anything typed while it was in flight stays dirty on top of the new
 * revision, so a save can never swallow the keystrokes that raced it.
 */
function save(
  frame: FrameSource,
  revisionId: string,
  written: ReadonlyMap<string, string>,
): FrameSource {
  const buffers = new Map<string, SourceBuffer>();
  for (const [path, buffer] of frame.buffers) {
    const text = written.get(path);
    if (text === undefined || text === buffer.draft) continue;
    buffers.set(path, {
      draft: buffer.draft,
      baseRevisionId: revisionId,
      baseText: text,
      conflict: null,
    });
  }
  const files = new Map(frame.files);
  for (const [path, text] of written) files.set(path, text);
  return { ...frame, revisionId, files, buffers };
}

function toMap(files: SourceFiles): Map<string, string> {
  return new Map(Object.entries(files));
}

// ── Selectors ────────────────────────────────────────────────────────

/** Every file the panel lists: the revision's own, plus any the user created. */
export function sourcePaths(frame: FrameSource): readonly string[] {
  return listPaths(frame.files, frame.buffers);
}

function listPaths(
  files: ReadonlyMap<string, string>,
  buffers: ReadonlyMap<string, SourceBuffer>,
): readonly string[] {
  const paths = new Set([...files.keys(), ...buffers.keys()]);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

/** What the editor shows for one path. */
export function sourceText(frame: FrameSource, path: string): string {
  return frame.buffers.get(path)?.draft ?? frame.files.get(path) ?? '';
}

export function isDirty(frame: FrameSource, path: string): boolean {
  const buffer = frame.buffers.get(path);
  if (!buffer) return false;
  return buffer.draft !== buffer.baseText || buffer.conflict !== null;
}

export function dirtyPaths(frame: FrameSource): readonly string[] {
  return sourcePaths(frame).filter((path) => isDirty(frame, path));
}

export function conflictPaths(frame: FrameSource): readonly string[] {
  return dirtyPaths(frame).filter((path) => frame.buffers.get(path)?.conflict);
}

/** Every frame holding unsaved work, so closing the panel can say what it drops. */
export function unsavedFrameIds(state: CanvasSourceState): readonly string[] {
  return [...state.frames]
    .filter(([, frame]) => dirtyPaths(frame).length > 0)
    .map(([designId]) => designId);
}

/**
 * The write Save sends for the open frame, or null when there is nothing to
 * save, a conflict is still open, or the dirty buffers disagree about their
 * base. Disagreement cannot happen through this reducer — a revision conflicts
 * every dirty buffer at once — and one write carries one `expectedRevisionId`,
 * so saving a buffer against a base it does not hold is refused here rather
 * than on disk.
 */
export function pendingWrite(
  state: CanvasSourceState,
): { expectedRevisionId: string | null; files: SourceFiles } | null {
  if (state.saving) return null;
  const frame = openFrameSource(state);
  const dirty = dirtyPaths(frame);
  if (dirty.length === 0 || conflictPaths(frame).length > 0) return null;
  const bases = new Set(dirty.map((path) => frame.buffers.get(path)?.baseRevisionId ?? null));
  if (bases.size > 1) return null;
  const files: SourceFiles = {};
  for (const path of dirty) files[path] = sourceText(frame, path);
  return { expectedRevisionId: [...bases][0] ?? null, files };
}

/**
 * The diagnostics a build left behind. A build that has not produced any yet
 * has none; that never means the last ones still stand.
 */
export function buildDiagnostics(build: CanvasBuildState): readonly CanvasDiagnostic[] {
  return build.status === 'ready' || build.status === 'failed' ? build.diagnostics : [];
}

/** One diagnostic placed in the editor, or in the panel's own list. */
export interface SourceIssue {
  diagnostic: CanvasDiagnostic;
  /** The listed file it belongs to, or null when it is not in this tree. */
  path: string | null;
  /** The 1-based line the build reported, or null when it named no line. */
  line: number | null;
}

/**
 * Places each diagnostic on a file and a line. A diagnostic can name a file
 * outside the frame's own tree — the pinned design kit is built with it — and a
 * failure in a generated module names no file at all. Neither can be pinned to
 * a line the user can see, so both stay unplaced instead of landing on the
 * wrong one.
 */
export function placeIssues(
  diagnostics: readonly CanvasDiagnostic[],
  paths: readonly string[],
): SourceIssue[] {
  const listed = new Set(paths);
  return diagnostics.map((diagnostic) => {
    const named = diagnostic.file;
    const path = named !== undefined && listed.has(named) ? named : null;
    const line = diagnostic.line;
    return {
      diagnostic,
      path,
      line: path !== null && line !== undefined && line > 0 ? line : null,
    };
  });
}

/** The issues the editor marks on one file's lines, by line number. */
export function issuesByLine(
  issues: readonly SourceIssue[],
  path: string,
): Map<number, SourceIssue[]> {
  const byLine = new Map<number, SourceIssue[]>();
  for (const issue of issues) {
    if (issue.path !== path || issue.line === null) continue;
    const held = byLine.get(issue.line);
    if (held) held.push(issue);
    else byLine.set(issue.line, [issue]);
  }
  return byLine;
}
