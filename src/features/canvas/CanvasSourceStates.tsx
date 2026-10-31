// What the source panel shows where a file would be (nothing to show, still
// reading, or a read that failed), and the bar a failed read leaves above the
// files it could not refresh.

import type { ReactNode } from 'react';
import { CircleAlert, FileText, Files, type IconComponent } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';
import type { FrameSource } from './canvasSourceState';
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

/** The editor area of a frame with no file open. */
export function SourceEmptyState({
  revisionId,
  source,
  onRetry,
}: {
  revisionId: string | null;
  source: FrameSource;
  onRetry: () => void;
}) {
  switch (emptyReason(revisionId, source)) {
    case 'reading':
      return <ReadingSkeleton />;
    case 'readFailed':
      return (
        <EditorState
          icon={CircleAlert}
          danger
          title="Couldn’t read the source"
          hint={source.read?.status === 'failed' ? source.read.message : ''}
        >
          <Button size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </EditorState>
      );
    case 'noRevision':
      return (
        <EditorState
          icon={FileText}
          title="No source yet"
          hint="Its code shows here once the agent writes it."
        />
      );
    case 'noFiles':
      return (
        <EditorState
          icon={Files}
          title="No files in this version"
          hint="This version was saved without any source files."
        />
      );
  }
}

/** A quiet, centred state where the editor would be: its mark, what it is, and why. */
function EditorState({
  icon,
  danger = false,
  title,
  hint,
  children,
}: {
  icon: IconComponent;
  danger?: boolean;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  const Icon = icon;
  return (
    <div
      role={danger ? 'alert' : undefined}
      className="canvas-state-reveal flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-code px-6 text-center"
    >
      <span
        className={cn(
          'mb-2 flex size-8 items-center justify-center rounded-lg',
          danger ? 'bg-danger-soft text-danger' : 'bg-elevated text-muted',
        )}
      >
        <Icon className="size-icon-md" aria-hidden />
      </span>
      <p className="text-body-strong text-primary">{title}</p>
      <p className="max-w-64 text-caption text-muted">{hint}</p>
      {children}
    </div>
  );
}

/** Indented lines in the shape of code, so the file reads in where they were. */
const SKELETON_LINES = ['w-2/5', 'ml-4 w-3/5', 'ml-8 w-1/2', 'ml-8 w-2/3', 'ml-4 w-1/3', 'w-1/4'];

function ReadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Reading this version’s source"
      data-delayed
      className="canvas-state-reveal flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-lg bg-code p-4"
    >
      {SKELETON_LINES.map((width) => (
        <div key={width} className={cn('skeleton-block h-3 shrink-0', width)} />
      ))}
    </div>
  );
}

/**
 * A read that failed while files are showing. Retry asks for the same revision
 * again; nothing here touches a buffer, because reopening the panel to force a
 * read is exactly how the user would lose the draft they are trying to keep.
 */
export function ReadFailure({
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
