// The source panel (spec §4): the files of one frame, edited and saved as a
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
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Spinner, X } from '@droidex/icons';
import { CodeCopyButton } from '../../components/MarkdownCode';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';
import {
  dirtyPaths,
  isDirty,
  isSaving,
  openFrameSource,
  canSave,
  saveFailure,
  sourcePaths,
  sourceText,
  unsavedFrameIds,
  type CanvasSourceAction,
  type CanvasSourceState,
  type FrameSource,
} from './canvasSourceState';
import {
  saveCanvasSource,
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
import { revisionNumber, useFrameHistory, type HistoryClient } from './frameHistory';
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
  /** Where the header reads which version of the frame is open. */
  history: HistoryClient;
  onClose: () => void;
}

export function CanvasSourcePanel({
  canvasId,
  frame,
  readSource,
  writeSource,
  history,
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
  const panel = useRef<HTMLElement>(null);
  const diagnostics = buildDiagnostics(frame.build);
  const version = revisionNumber(useFrameHistory(history, frame).list, frame.revisionId);

  // Opening the panel from a frame hands it the keyboard, so Tab and Escape
  // work here straight away.
  useEffect(() => {
    dispatch({ type: 'openSourcePanel', designId: frame.designId });
    panel.current?.focus({ preventScroll: true });
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
  const canSubmit = canSave(state);
  const unsaved = unsavedFrameIds(state);
  const issues = useMemo(() => placeIssues(diagnostics, paths), [diagnostics, paths]);
  const conflict = activePath === null ? undefined : source.buffers.get(activePath)?.conflict;
  const failure = saveFailure(state);

  const save = useCallback(() => {
    void saveCanvasSource(canvasId, crypto.randomUUID(), writeSource);
  }, [canvasId, writeSource]);

  const close = useCallback(() => {
    forgetCanvasSource(canvasId);
    onClose();
  }, [canvasId, onClose]);

  // Spec §4: the buffers are the one piece of state nothing else holds a copy
  // of, so closing with unsaved work asks first.
  const requestClose = () => {
    if (unsaved.length > 0) setConfirmingClose(true);
    else close();
  };

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={`Source of ${frame.name}`}
      className="flex h-full min-h-0 w-full flex-col gap-2 rounded-xl bg-surface p-3 focus:outline-none"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (confirmingClose) setConfirmingClose(false);
        else requestClose();
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
        <header className="flex shrink-0 items-center gap-1">
          <h2 className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-body-strong text-primary">{frame.name}</span>
            <span className="shrink-0 text-caption tabular-nums text-muted">
              {versionLabel(frame.revisionId, version)}
            </span>
          </h2>
          {activePath !== null && <CodeCopyButton text={sourceText(source, activePath)} />}
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={!canSubmit}
            title="Save and rebuild (⌘S)"
          >
            {saveLabel(state)}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close source"
            title="Close (Escape)"
            onClick={requestClose}
          />
        </header>
      )}
      {failure === null ? null : (
        <p role="alert" className="shrink-0 text-caption text-danger">
          {failure}
        </p>
      )}

      <FileTabs
        paths={paths}
        source={source}
        issues={issues}
        onSelect={(path) => {
          dispatch({ type: 'selectFile', path });
        }}
      />
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
        <EmptyEditor reason={emptyReason(frame.revisionId, source)} />
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
                fallback={<div aria-hidden className="min-h-0 flex-1 rounded-lg bg-code" />}
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
    </section>
  );
}

function versionLabel(revisionId: string | null, version: number | null): string {
  if (revisionId === null) return 'No source yet';
  return version === null ? '' : `v${String(version)}`;
}

/** Why the editor area has no file to show. */
type EmptyReason = 'noRevision' | 'reading' | 'readFailed' | 'noFiles';

/**
 * "No source yet" belongs only to a frame that has never built a revision. A
 * revision the panel does not hold yet is still arriving — including the render
 * before the read starts, and every render while a save is in flight against a
 * revision this frame has — and a failed read says so beside its own Retry.
 */
function emptyReason(revisionId: string | null, source: FrameSource): EmptyReason {
  if (revisionId === null) return 'noRevision';
  if (source.read?.status === 'failed') return 'readFailed';
  if (source.read?.status === 'loading' || source.revisionId !== revisionId) return 'reading';
  return 'noFiles';
}

const EMPTY_MESSAGE: Record<EmptyReason, string> = {
  noRevision: 'This frame has no source yet.',
  reading: 'Reading this version’s source…',
  readFailed: 'Source could not be read.',
  noFiles: 'This version has no source files.',
};

function EmptyEditor({ reason }: { reason: EmptyReason }) {
  return (
    <p
      role={reason === 'reading' ? 'status' : undefined}
      className="flex min-h-0 flex-1 items-center justify-center gap-2 rounded-lg bg-code text-body text-secondary"
    >
      {reason === 'reading' && (
        <Spinner className="size-icon-md shrink-0 animate-spin text-muted" aria-hidden />
      )}
      {EMPTY_MESSAGE[reason]}
    </p>
  );
}

/**
 * A read that failed. Retry asks for the same revision again; nothing here
 * touches a buffer, because reopening the panel to force a read is exactly how
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
      className="flex shrink-0 items-center gap-2 rounded-lg bg-elevated py-1 pl-3 pr-1 text-caption text-secondary"
    >
      <span className="min-w-0 flex-1">
        <span className="text-danger">{message}</span>
        {keeping ? ' Your unsaved edits are still here.' : null}
      </span>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** One tab per file; a file shares its name with another only by showing its path. */
function FileTabs({
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
  const names = paths.map(fileName);
  return (
    <nav
      aria-label="Source files"
      className="scrollbar-on-hover -mx-1 flex shrink-0 gap-1 overflow-x-auto px-1"
    >
      {paths.map((path, index) => {
        const name = names[index];
        const shared = names.indexOf(name) !== names.lastIndexOf(name);
        const faults = issues.filter((issue) => issue.path === path).length;
        const open = path === source.activePath;
        return (
          <button
            key={path}
            type="button"
            title={path}
            aria-current={open}
            onClick={() => {
              onSelect(path);
            }}
            className={cn(
              'flex h-control-sm max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-label transition-colors',
              open
                ? 'bg-elevated text-primary'
                : 'text-muted hover:bg-elevated hover:text-secondary',
            )}
          >
            <span className="min-w-0 truncate">{shared ? path : name}</span>
            {faults > 0 && <span className="tabular-nums text-danger">{String(faults)}</span>}
            {isDirty(source, path) && (
              <span
                title="Unsaved changes"
                aria-label="Unsaved changes"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            )}
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
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 rounded-lg bg-elevated py-1 pl-3 pr-1 text-caption text-secondary"
    >
      <span className="min-w-0 flex-1">
        {frames === 1
          ? 'This frame has unsaved source. Close and discard it?'
          : `${String(frames)} frames have unsaved source. Close and discard it?`}
      </span>
      <Button ref={keep} size="sm" onClick={onCancel}>
        Keep editing
      </Button>
      <Button variant="danger" size="sm" onClick={onDiscard}>
        Discard
      </Button>
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
      className="scrollbar-on-hover -mx-1 max-h-28 shrink-0 overflow-y-auto px-1"
    >
      {issues.map((issue, index) => (
        <li key={`${issue.diagnostic.code}-${String(index)}`}>
          <button
            type="button"
            onClick={() => {
              onReveal(issue);
            }}
            disabled={issue.path === null}
            className="flex w-full gap-2 rounded-md px-2 py-1 text-left font-mono text-code-sm text-secondary transition-colors enabled:hover:bg-elevated disabled:cursor-default"
          >
            <span className="shrink-0 text-danger">
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

/** Unknown outcomes offer exact replay; refused writes allow a new Save. */
function saveLabel(state: CanvasSourceState): string {
  if (isSaving(state)) return 'Saving…';
  return state.save?.status === 'uncertain' ? 'Try that save again' : 'Save and rebuild';
}

/** Why a read failed, in the runtime's wording where it gave one. */
function readMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'This version’s source could not be read.';
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
