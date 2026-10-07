// The source drawer (spec §4): the files of one frame, edited and saved as a
// normal source revision. The sidecar owns the revisions; `canvasSourceStore.ts`
// owns the buffers, and this panel never loses one — not to a save that races the
// typing, not to a revision the agent commits underneath it, not to a frame
// switch, and not to its own unmounting when the user looks at another tab.

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  dirtyPaths,
  isDirty,
  isSaving,
  openFrameSource,
  pendingWrite,
  saveFailure,
  sourcePaths,
  sourceText,
  unsavedFrameIds,
  type CanvasSourceAction,
  type CanvasSourceState,
  type FrameSource,
} from './canvasSourceState';
import {
  beginCanvasSave,
  dispatchCanvasSource,
  forgetCanvasSource,
  readCanvasSource,
  subscribeCanvasSource,
} from './canvasSourceStore';
import {
  buildDiagnostics,
  issuesByLine,
  placeIssues,
  type SourceIssue,
} from './canvasSourceIssues';
import { CompareCaption, ConflictBar, ConflictCompare } from './CanvasSourceConflict';
import type { CanvasFrame, SourceFiles, WriteFilesInput, WriteReceipt } from './protocol';

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
  /** Sends one submitted write exactly as the store minted it. */
  writeSource: (canvasId: string, write: WriteFilesInput) => Promise<WriteReceipt>;
  onClose: () => void;
}

export function CanvasSourcePanel({
  canvasId,
  frame,
  readSource,
  writeSource,
  onClose,
}: CanvasSourcePanelProps) {
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeCanvasSource(canvasId, listener), [canvasId]),
    useCallback(() => readCanvasSource(canvasId), [canvasId]),
  );
  const dispatch = useCallback(
    (action: CanvasSourceAction) => {
      dispatchCanvasSource(canvasId, action);
    },
    [canvasId],
  );
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [comparing, setComparing] = useState(false);
  const diagnostics = buildDiagnostics(frame.build);

  useEffect(() => {
    dispatch({ type: 'openSourcePanel', designId: frame.designId });
  }, [dispatch, frame.designId]);

  const source = openFrameSource(state);
  const read = source.read;

  // One read per revision a frame reaches, and one more per Retry. A clean frame
  // follows the head and a dirty one conflicts, which is the reducer's business,
  // not this effect's.
  useEffect(() => {
    const { designId, revisionId } = frame;
    if (revisionId === null) return;
    let wanted = true;
    dispatch({ type: 'reading', designId, revisionId });
    readSource(canvasId, designId, revisionId).then(
      (files) => {
        if (wanted) dispatch({ type: 'loaded', designId, revisionId, files, diagnostics });
      },
      (error: unknown) => {
        if (wanted)
          dispatch({ type: 'readFailed', designId, revisionId, message: readMessage(error) });
      },
    );
    return () => {
      wanted = false;
    };
    // `diagnostics` is read, not watched: a rebuild of the same revision must
    // not re-read the tree the user is typing in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, dispatch, frame.designId, frame.revisionId, readSource, source.readAttempt]);

  const paths = sourcePaths(source);
  const activePath = source.activePath;
  const write = pendingWrite(state);
  const unsaved = unsavedFrameIds(state);
  const issues = useMemo(() => placeIssues(diagnostics, paths), [diagnostics, paths]);
  const conflict = activePath === null ? undefined : source.buffers.get(activePath)?.conflict;
  const failure = saveFailure(state);

  // A write outlives this panel, so its outcome goes straight to the store: a
  // Save must settle even if the user looked at another tab while it was away.
  const save = useCallback(() => {
    const submitted = beginCanvasSave(canvasId, crypto.randomUUID());
    if (!submitted) return;
    writeSource(canvasId, submitted).then(
      (receipt) => {
        dispatchCanvasSource(canvasId, { type: 'saved', revisionId: receipt.revisionId });
      },
      (error: unknown) => {
        dispatchCanvasSource(canvasId, { type: 'saveFailed', message: saveMessage(error) });
      },
    );
  }, [canvasId, writeSource]);

  const close = useCallback(() => {
    forgetCanvasSource(canvasId);
    onClose();
  }, [canvasId, onClose]);

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
          {failure === null ? null : (
            <p role="alert" className="min-w-0 truncate text-[11px] text-droid-red">
              {failure}
            </p>
          )}
          <button
            onClick={save}
            disabled={write === null}
            title="Save and rebuild (⌘S)"
            // A low-alpha accent tint, not `elevated`: on a dark theme `raised`
            // resolves to the elevated rung, and the pane's primary action
            // would read as plain text (05a's note).
            className="rounded-lg bg-droid-accent/10 px-2.5 py-1 text-[11px] text-droid-text transition-colors enabled:hover:bg-droid-accent/20 disabled:bg-transparent disabled:text-droid-text-muted"
          >
            {saveLabel(state)}
          </button>
          <button
            onClick={() => {
              // Spec §4: the buffers are the one piece of state nothing else
              // holds a copy of, so closing with unsaved work asks first.
              if (unsaved.length > 0) setConfirmingClose(true);
              else close();
            }}
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
          {read?.status === 'failed' ? (
            <ReadFailure
              message={read.message}
              keeping={dirtyPaths(source).length > 0}
              onRetry={() => {
                dispatch({ type: 'retryRead' });
              }}
            />
          ) : null}
          {activePath === null ? (
            <EmptyEditor reading={read?.status === 'loading'} />
          ) : (
            <>
              {conflict ? (
                <ConflictBar
                  comparing={comparing}
                  onCompare={() => {
                    setComparing((open) => !open);
                  }}
                  onKeepMine={() => {
                    setComparing(false);
                    dispatch({ type: 'keepMine', path: activePath });
                  }}
                  onTakeTheirs={() => {
                    setComparing(false);
                    dispatch({ type: 'takeTheirs', path: activePath });
                  }}
                />
              ) : null}
              <div className="flex min-h-0 flex-1 gap-2">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
                  {conflict && comparing ? <CompareCaption>Yours · unsaved</CompareCaption> : null}
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
                      onChange={(text) => {
                        dispatch({ type: 'edit', path: activePath, text });
                      }}
                      onSave={save}
                    />
                  </Suspense>
                </div>
                {conflict && comparing ? (
                  <ConflictCompare
                    path={activePath}
                    revisionId={conflict.revisionId}
                    text={conflict.text}
                    issues={issuesByLine(issues, activePath)}
                  />
                ) : null}
              </div>
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

/**
 * What the editor area says with no file to show: a frame that genuinely has no
 * source, or a read that has not answered yet. A failed read says so on its own
 * row, with Retry, rather than claiming the frame is empty.
 */
function EmptyEditor({ reading }: { reading: boolean }) {
  return (
    <p
      role={reading ? 'status' : undefined}
      className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-droid-surface text-[12px] text-droid-text-secondary"
    >
      {reading ? 'Reading this revision’s source…' : 'This frame has no source yet.'}
    </p>
  );
}

/**
 * A read that failed. Retry asks for the same revision again; nothing here
 * touches a buffer, because reopening the drawer to force a read is exactly how
 * the user would lose the draft they are trying to keep.
 */
function ReadFailure({
  message,
  keeping,
  onRetry,
}: {
  message: string;
  keeping: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 rounded-xl bg-droid-elevated px-3 py-2 text-[11px] text-droid-text-secondary"
    >
      <span className="min-w-0 flex-1">
        <span className="text-droid-red">{message}</span>
        {keeping ? ' Your unsaved edits are still here.' : null}
      </span>
      <button
        onClick={onRetry}
        className="rounded-lg bg-droid-accent/15 px-2 py-1 text-droid-text transition-colors hover:bg-droid-accent/25"
      >
        Try again
      </button>
    </div>
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
        className="rounded-lg bg-droid-accent/15 px-2 py-1 text-droid-text transition-colors hover:bg-droid-accent/25"
      >
        Keep editing
      </button>
      <button
        onClick={onDiscard}
        className="rounded-lg px-2 py-1 text-droid-red transition-colors hover:bg-droid-accent/10"
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
            className="flex w-full gap-2 rounded-lg px-2 py-1 text-left font-mono text-[11px] leading-5 text-droid-text-secondary transition-colors enabled:hover:bg-droid-elevated disabled:cursor-default"
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

/**
 * What the Save button says. A failed Save offers the same write again rather
 * than a fresh one: the store still holds its mutation identity, so the runtime
 * can answer the retry from its own ledger instead of committing twice.
 */
function saveLabel(state: CanvasSourceState): string {
  if (isSaving(state)) return 'Saving…';
  return saveFailure(state) === null ? 'Save and rebuild' : 'Try that save again';
}

/** The sidecar's own recovery wording, or a neutral line for a lost request. */
function saveMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'That save did not reach the runtime. Try again.';
}

/** Why a read failed, in the runtime's wording where it gave one. */
function readMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'This revision’s source could not be read.';
}
