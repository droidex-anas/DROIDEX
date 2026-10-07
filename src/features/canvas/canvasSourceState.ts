// The source drawer's state, as a pure reducer. The sidecar owns canonical
// source; this module owns the two things it cannot: what the user has typed and
// has not saved yet, and which write the drawer is still waiting on.
// `canvasSourceStore.ts` holds one of these per canvas, outside the components,
// so neither survives only as long as a mounted panel.
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

import type { CanvasDiagnostic, SourceFiles, WriteFilesInput } from './protocol';

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
  /**
   * The read this frame is waiting on or could not finish, and null once its
   * files are current. A failure keeps the revision it was for, so Retry can ask
   * for that one again without going near a buffer.
   */
  read: SourceRead | null;
  /** Bumped by Retry, so the read runs again for a revision it already tried. */
  readAttempt: number;
}

export type SourceRead =
  | { status: 'loading'; revisionId: string }
  | { status: 'failed'; revisionId: string; message: string };

/** Transport uncertainty retains the exact request; a server refusal releases it. */
export type SourceSave =
  | { status: 'saving'; write: WriteFilesInput; sourceRevisionId: string | null }
  | {
      status: 'uncertain';
      write: WriteFilesInput;
      sourceRevisionId: string | null;
      message: string;
    }
  | { status: 'refused'; designId: string; message: string };

export interface CanvasSourceState {
  /** The frame whose source is open, or null while the panel is closed. */
  openDesignId: string | null;
  /** Keyed by design ID. A frame the user leaves keeps its unsaved buffers. */
  frames: ReadonlyMap<string, FrameSource>;
  /** The active save or its actionable refusal, until another save begins. */
  save: SourceSave | null;
}

const EMPTY_FRAME: FrameSource = {
  revisionId: null,
  files: new Map(),
  activePath: null,
  buffers: new Map(),
  diagnostics: [],
  read: null,
  readAttempt: 0,
};

export const emptyCanvasSourceState: CanvasSourceState = {
  openDesignId: null,
  frames: new Map(),
  save: null,
};

export type CanvasSourceAction =
  /** The toolbar's Source action, and the panel slot's only way in. */
  | { type: 'openSourcePanel'; designId: string }
  /** A read is in flight for one revision of one frame. */
  | { type: 'reading'; designId: string; revisionId: string }
  /** That read failed, with the recovery wording to offer beside Retry. */
  | { type: 'readFailed'; designId: string; revisionId: string; message: string }
  /** Asks for the open frame's failed read again, keeping every buffer. */
  | { type: 'retryRead' }
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
  /**
   * Submits dirty buffers, or replays an unresolved request verbatim.
   */
  | { type: 'saving'; mutationId: string }
  /** The receipt for the submitted write, which is the one record of what it carried. */
  | { type: 'saved'; revisionId: string }
  | { type: 'saveFailed'; message: string }
  | { type: 'saveRefused'; message: string };

export function canvasSourceReducer(
  state: CanvasSourceState,
  action: CanvasSourceAction,
): CanvasSourceState {
  switch (action.type) {
    case 'openSourcePanel':
      return { ...state, openDesignId: action.designId };
    case 'reading':
      return withFrame(state, action.designId, (frame) => ({
        ...frame,
        read: { status: 'loading', revisionId: action.revisionId },
      }));
    case 'readFailed':
      return withFrame(state, action.designId, (frame) =>
        // A read the frame has moved on from has nothing left to report.
        frame.read?.revisionId === action.revisionId
          ? {
              ...frame,
              read: { status: 'failed', revisionId: action.revisionId, message: action.message },
            }
          : frame,
      );
    case 'retryRead':
      return onOpenFrame(state, (frame) =>
        frame.read?.status === 'failed'
          ? {
              ...frame,
              read: { status: 'loading', revisionId: frame.read.revisionId },
              readAttempt: frame.readAttempt + 1,
            }
          : frame,
      );
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
      return submit(state, action.mutationId);
    case 'saved':
      return settle(state, action.revisionId);
    case 'saveFailed':
    case 'saveRefused': {
      const save = state.save;
      if (save?.status !== 'saving') return state;
      return {
        ...state,
        save:
          action.type === 'saveRefused'
            ? { status: 'refused', designId: save.write.designId, message: action.message }
            : { ...save, status: 'uncertain', message: action.message },
      };
    }
  }
}

/** An unknown outcome owns its request until an authoritative reply settles it. */
function submit(state: CanvasSourceState, mutationId: string): CanvasSourceState {
  if (isSaving(state)) return state;
  if (state.save?.status === 'uncertain')
    return {
      ...state,
      save: {
        status: 'saving',
        write: state.save.write,
        sourceRevisionId: state.save.sourceRevisionId,
      },
    };
  const next = pendingWrite(state);
  const designId = state.openDesignId;
  if (next === null || designId === null) return state;
  return {
    ...state,
    save: {
      status: 'saving',
      sourceRevisionId: openFrameSource(state).revisionId,
      write: { mutationId, designId, ...next, deletedPaths: [] },
    },
  };
}

/** Applies the receipt for the submitted write, which is the record of what it carried. */
function settle(state: CanvasSourceState, revisionId: string): CanvasSourceState {
  const submitted = state.save;
  if (submitted === null || submitted.status === 'refused') return state;
  return {
    ...withFrame(state, submitted.write.designId, (frame) =>
      save(frame, revisionId, submitted.sourceRevisionId, toMap(submitted.write.files)),
    ),
    save: null,
  };
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
  if (loaded.revisionId === frame.revisionId)
    return { ...frame, diagnostics: loaded.diagnostics, read: null };
  const files = toMap(loaded.files);
  const buffers = new Map<string, SourceBuffer>();
  for (const [path, buffer] of frame.buffers) {
    // A clean buffer has nothing to lose and follows the head.
    if (!isLive(buffer)) continue;
    const text = files.get(path) ?? null;
    // The revision left this file as the edit found it, so the edit still
    // applies and only its base moves: a Save against the revision it was typed
    // on would be refused for a change somewhere else in the tree. Any earlier
    // conflict is settled too — the text it offered is no longer the head's, so
    // comparing or reapplying against it would target a superseded revision.
    if (text === buffer.baseText || loaded.revisionId === null)
      buffers.set(path, { ...buffer, baseRevisionId: loaded.revisionId, conflict: null });
    else buffers.set(path, { ...buffer, conflict: { revisionId: loaded.revisionId, text } });
  }
  return {
    revisionId: loaded.revisionId,
    files,
    activePath: activePath(frame.activePath, files, buffers),
    buffers,
    diagnostics: loaded.diagnostics,
    read: null,
    readAttempt: frame.readAttempt,
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

/** A receipt proves a commit, but cannot supersede a head read after submission. */
function save(
  frame: FrameSource,
  revisionId: string,
  sourceRevisionId: string | null,
  written: ReadonlyMap<string, string>,
): FrameSource {
  const hasNewerHead = frame.revisionId !== sourceRevisionId && frame.revisionId !== revisionId;
  const files = new Map(frame.files);
  if (!hasNewerHead) {
    for (const [path, text] of written) files.set(path, text);
  }
  const headRevisionId = hasNewerHead ? frame.revisionId : revisionId;
  const buffers = new Map<string, SourceBuffer>();
  for (const [path, buffer] of frame.buffers) {
    const text = written.get(path);
    if (text === undefined) {
      // Omitted paths were never submitted; retain their current conflicts too.
      if (isLive(buffer))
        buffers.set(path, hasNewerHead ? buffer : { ...buffer, baseRevisionId: revisionId });
      continue;
    }
    const canonical = files.get(path) ?? null;
    const conflict =
      hasNewerHead && headRevisionId !== null && canonical !== text
        ? { revisionId: headRevisionId, text: canonical }
        : null;
    if (buffer.draft === text && conflict === null) continue;
    buffers.set(path, {
      draft: buffer.draft,
      baseRevisionId: conflict === null ? headRevisionId : revisionId,
      baseText: text,
      conflict,
    });
  }
  return { ...frame, revisionId: headRevisionId, files, buffers };
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
  return buffer !== undefined && isLive(buffer);
}

/** A buffer still worth holding: its draft has moved, or it is in conflict. */
function isLive(buffer: SourceBuffer): boolean {
  return buffer.draft !== buffer.baseText || buffer.conflict !== null;
}

export function dirtyPaths(frame: FrameSource): readonly string[] {
  return sourcePaths(frame).filter((path) => isDirty(frame, path));
}

export function conflictPaths(frame: FrameSource): readonly string[] {
  return dirtyPaths(frame).filter((path) => frame.buffers.get(path)?.conflict);
}

/** The write a Save submitted and has no answer for yet, or null when none is. */
export function submittedWrite(state: CanvasSourceState): WriteFilesInput | null {
  return state.save?.status === 'saving' ? state.save.write : null;
}

/** True from a Save's submission until the sidecar answers it one way or another. */
export function isSaving(state: CanvasSourceState): boolean {
  return submittedWrite(state) !== null;
}

/**
 * The last save's failure. An uncertain write must remain actionable even after
 * the user selects another frame; it still owns the next Save.
 */
export function saveFailure(state: CanvasSourceState): string | null {
  const save = state.save;
  if (save === null || save.status === 'saving') return null;
  if (save.status === 'refused' && save.designId !== state.openDesignId) return null;
  return save.message;
}

/** Held retries are available even when the selected frame cannot submit a new write. */
export function canSave(state: CanvasSourceState): boolean {
  return state.save?.status === 'uncertain' || pendingWrite(state) !== null;
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
  if (isSaving(state)) return null;
  const frame = openFrameSource(state);
  const dirty = dirtyPaths(frame);
  if (dirty.length === 0 || conflictPaths(frame).length > 0) return null;
  const bases = new Set(dirty.map((path) => frame.buffers.get(path)?.baseRevisionId ?? null));
  if (bases.size > 1) return null;
  const files: SourceFiles = {};
  for (const path of dirty) files[path] = sourceText(frame, path);
  return { expectedRevisionId: [...bases][0] ?? null, files };
}
