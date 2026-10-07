// The source drawer (spec §4): the files of one frame, edited and saved as a
// normal source revision. The sidecar owns the revisions; this panel owns the
// buffers (canvasSourceState.ts) and never loses one — not to a save that races
// the typing, not to a revision the agent commits underneath it, and not to a
// frame switch, which keeps each frame's buffers.

import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  buildDiagnostics,
  canvasSourceReducer,
  emptyCanvasSourceState,
  isDirty,
  issuesByLine,
  openFrameSource,
  pendingWrite,
  placeIssues,
  sourcePaths,
  sourceText,
  unsavedFrameIds,
  type FrameSource,
  type SourceIssue,
} from './canvasSourceState';
import type { CanvasFrame, SourceFiles, WriteReceipt } from './protocol';

// Prism and the editor's chrome load with the first file the user opens, not
// with the board.
const LazyEditor = lazy(async () => ({
  default: (await import('./CanvasSourceEditor')).CanvasSourceEditor,
}));

export interface CanvasSourcePanelProps {
  canvasId: string;
  /** The frame whose source is open. */
  frame: CanvasFrame;
  readSource: (canvasId: string, designId: string, revisionId: string) => Promise<SourceFiles>;
  writeSource: (
    canvasId: string,
    designId: string,
    expectedRevisionId: string | null,
    files: SourceFiles,
  ) => Promise<WriteReceipt>;
  onClose: () => void;
}

export function CanvasSourcePanel({
  canvasId,
  frame,
  readSource,
  writeSource,
  onClose,
}: CanvasSourcePanelProps) {
  const [state, dispatch] = useReducer(canvasSourceReducer, emptyCanvasSourceState);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const diagnostics = buildDiagnostics(frame.build);

  useEffect(() => {
    dispatch({ type: 'openSourcePanel', designId: frame.designId });
  }, [frame.designId]);

  // One read per revision a frame reaches. A clean frame follows the head and a
  // dirty one conflicts, which is the reducer's business, not this effect's.
  useEffect(() => {
    const { designId, revisionId } = frame;
    if (revisionId === null) return;
    let wanted = true;
    readSource(canvasId, designId, revisionId).then(
      (files) => {
        if (wanted) dispatch({ type: 'loaded', designId, revisionId, files, diagnostics });
      },
      (error: unknown) => {
        console.error('Canvas could not read a revision’s source:', error);
      },
    );
    return () => {
      wanted = false;
    };
    // `diagnostics` is read, not watched: a rebuild of the same revision must
    // not re-read the tree the user is typing in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, frame.designId, frame.revisionId, readSource]);

  const source = openFrameSource(state);
  const paths = sourcePaths(source);
  const activePath = source.activePath;
  const write = pendingWrite(state);
  const unsaved = unsavedFrameIds(state);
  const issues = useMemo(() => placeIssues(diagnostics, paths), [diagnostics, paths]);

  const save = useCallback(() => {
    const next = pendingWrite(state);
    if (!next) return;
    const designId = state.openDesignId;
    if (designId === null) return;
    dispatch({ type: 'saving' });
    writeSource(canvasId, designId, next.expectedRevisionId, next.files).then(
      (receipt) => {
        dispatch({ type: 'saved', designId, revisionId: receipt.revisionId, files: next.files });
      },
      (error: unknown) => {
        dispatch({ type: 'saveFailed', message: saveMessage(error) });
      },
    );
  }, [canvasId, state, writeSource]);

  const close = useCallback(() => {
    dispatch({ type: 'closeSourcePanel' });
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    // Spec §4: the buffers are the one piece of state nothing else holds a copy
    // of, so closing with unsaved work asks before it drops them.
    if (unsaved.length > 0) setConfirmingClose(true);
    else close();
  }, [close, unsaved.length]);

  return (
    <section
      aria-label={`Source of ${frame.name}`}
      className="flex h-full min-h-0 w-full flex-col gap-2.5 rounded-2xl bg-droid-raised p-3 shadow-droid-sm"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (confirmingClose) setConfirmingClose(false);
        else if (unsaved.length === 0) close();
      }}
    >
      {confirmingClose ? (
        <DiscardBar
          frames={unsaved.length}
          onDiscard={close}
          onCancel={() => {
            setConfirmingClose(false);
          }}
        />
      ) : (
        <header className="flex shrink-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[12px] font-medium text-droid-text">
            {frame.name}
            <span className="pl-2 font-normal text-droid-text-muted">
              {frame.revisionId ?? 'no source yet'}
            </span>
          </h2>
          {state.saveError ? (
            <p role="alert" className="max-w-[55%] truncate text-[11px] text-droid-red">
              {state.saveError}
            </p>
          ) : null}
          <button
            onClick={save}
            disabled={write === null}
            title="Save and rebuild (⌘S)"
            className="rounded-lg bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text transition-colors hover:bg-droid-active disabled:text-droid-text-muted/60 disabled:hover:bg-droid-elevated"
          >
            {state.saving ? 'Saving…' : 'Save and rebuild'}
          </button>
          <button
            onClick={requestClose}
            className="rounded-lg px-2 py-1 text-[11px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
          >
            Close
          </button>
        </header>
      )}

      <div className="flex min-h-0 flex-1 gap-2.5">
        <FileList
          paths={paths}
          source={source}
          issues={issues}
          onSelect={(path) => {
            dispatch({ type: 'selectFile', path });
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {activePath === null ? (
            <p className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-droid-surface text-[12px] text-droid-text-secondary">
              This frame has no source yet.
            </p>
          ) : (
            <>
              {source.buffers.get(activePath)?.conflict ? (
                <ConflictBar
                  onKeepMine={() => {
                    dispatch({ type: 'keepMine', path: activePath });
                  }}
                  onTakeTheirs={() => {
                    dispatch({ type: 'takeTheirs', path: activePath });
                  }}
                />
              ) : null}
              <Suspense
                fallback={
                  <div aria-hidden className="min-h-0 flex-1 rounded-xl bg-droid-surface" />
                }
              >
                <LazyEditor
                  key={`${frame.designId}:${activePath}`}
                  path={activePath}
                  text={sourceText(source, activePath)}
                  issues={issuesByLine(issues, activePath)}
                  reveal={reveal}
                  readOnly={state.saving}
                  onChange={(text) => {
                    dispatch({ type: 'edit', path: activePath, text });
                  }}
                  onSave={save}
                />
              </Suspense>
            </>
          )}
          <IssueList
            issues={issues}
            onReveal={(issue) => {
              if (issue.path !== null) dispatch({ type: 'selectFile', path: issue.path });
              const line = issue.line;
              if (line !== null) setReveal((held) => ({ line, nonce: (held?.nonce ?? 0) + 1 }));
            }}
          />
        </div>
      </div>
    </section>
  );
}

function FileList({
  paths,
  source,
  issues,
  onSelect,
}: {
  paths: readonly string[];
  source: FrameSource;
  issues: readonly SourceIssue[];
  onSelect: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <nav
      aria-label="Source files"
      className="scrollbar-on-hover w-44 shrink-0 overflow-y-auto rounded-xl bg-droid-surface p-1"
    >
      {paths.map((path) => {
        const faults = issues.filter((issue) => issue.path === path).length;
        const open = path === source.activePath;
        return (
          <button
            key={path}
            onClick={() => {
              onSelect(path);
            }}
            aria-current={open}
            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
              open
                ? 'bg-droid-active text-droid-text'
                : 'text-droid-text-secondary hover:bg-droid-elevated'
            }`}
          >
            <span className="min-w-0 flex-1 truncate" title={path}>
              {path}
            </span>
            {faults > 0 ? <span className="text-droid-red">{String(faults)}</span> : null}
            {isDirty(source, path) ? (
              <span
                title="Unsaved changes"
                aria-label="Unsaved changes"
                className="size-1.5 shrink-0 rounded-full bg-droid-accent"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/** Spec §4: a conflict preserves the buffer and never silently overwrites it. */
function ConflictBar({
  onKeepMine,
  onTakeTheirs,
}: {
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 rounded-xl bg-droid-elevated px-3 py-2 text-[11px] text-droid-text-secondary"
    >
      <span className="min-w-0 flex-1">
        Updated by agent. Your edits are still here, and so is their version.
      </span>
      <button
        onClick={onKeepMine}
        className="rounded-lg bg-droid-active px-2 py-1 text-droid-text transition-colors hover:bg-droid-raised"
      >
        Keep mine
      </button>
      <button
        onClick={onTakeTheirs}
        className="rounded-lg px-2 py-1 transition-colors hover:bg-droid-active hover:text-droid-text"
      >
        Take theirs
      </button>
    </div>
  );
}

/** Closing with unsaved buffers, asked in the header rather than in a dialog. */
function DiscardBar({
  frames,
  onDiscard,
  onCancel,
}: {
  frames: number;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 rounded-xl bg-droid-elevated px-3 py-1.5 text-[11px] text-droid-text-secondary"
    >
      <span className="min-w-0 flex-1">
        {frames === 1
          ? 'This frame has unsaved source. Close and discard it?'
          : `${String(frames)} frames have unsaved source. Close and discard it?`}
      </span>
      <button
        onClick={onCancel}
        className="rounded-lg bg-droid-active px-2 py-1 text-droid-text transition-colors hover:bg-droid-raised"
      >
        Keep editing
      </button>
      <button
        onClick={onDiscard}
        className="rounded-lg px-2 py-1 text-droid-red transition-colors hover:bg-droid-active"
      >
        Discard
      </button>
    </div>
  );
}

/**
 * The build's own diagnostics, each at the file and line it named. A diagnostic
 * from outside this tree — the pinned kit, or a generated module — is listed
 * without a place rather than pinned to a line it does not belong to.
 */
function IssueList({
  issues,
  onReveal,
}: {
  issues: readonly SourceIssue[];
  onReveal: (issue: SourceIssue) => void;
}) {
  if (issues.length === 0) return null;
  return (
    <ul
      aria-label="Build problems"
      className="scrollbar-on-hover max-h-28 shrink-0 overflow-y-auto rounded-xl bg-droid-surface p-1"
    >
      {issues.map((issue, index) => (
        <li key={`${issue.diagnostic.code}-${String(index)}`}>
          <button
            onClick={() => {
              onReveal(issue);
            }}
            disabled={issue.path === null}
            className="flex w-full gap-2 rounded-lg px-2 py-1 text-left font-mono text-[11px] leading-[17px] text-droid-text-secondary transition-colors enabled:hover:bg-droid-elevated disabled:cursor-default"
          >
            <span className="shrink-0 text-droid-red">
              {issue.path === null
                ? (issue.diagnostic.file ?? 'build')
                : `${issue.path}${issue.line === null ? '' : `:${String(issue.line)}`}`}
            </span>
            <span className="min-w-0 flex-1 truncate">{issue.diagnostic.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The sidecar's own recovery wording, or a neutral line for a lost request. */
function saveMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'That save did not reach the runtime. Try again.';
}
