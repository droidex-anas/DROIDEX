// A conflict, as the user has to be able to settle it. Spec §4: "A conflict
// preserves that buffer and offers comparison/reapply, never silent overwrite."
// Holding both texts is not the whole of that — the user cannot choose between
// two versions they have only been told about, so Compare puts the agent's
// version beside their draft, read-only, and Keep mine then reapplies the draft
// on top of that revision as an ordinary CAS save.

import type { ReactNode } from 'react';
import { SourceCode, SourceScroller } from './CanvasSourceCode';
import type { SourceIssue } from './canvasSourceIssues';

/** Spec §4: a conflict preserves the buffer and never silently overwrites it. */
export function ConflictBar({
  comparing,
  onCompare,
  onKeepMine,
  onTakeTheirs,
}: {
  comparing: boolean;
  onCompare: () => void;
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
        onClick={onCompare}
        aria-pressed={comparing}
        className={`rounded-lg px-2 py-1 transition-colors hover:bg-droid-accent/10 hover:text-droid-text ${
          comparing ? 'bg-droid-accent/10 text-droid-text' : ''
        }`}
      >
        {comparing ? 'Hide theirs' : 'Compare'}
      </button>
      <button
        onClick={onKeepMine}
        title="Reapply your edits on top of their revision"
        className="rounded-lg bg-droid-accent/15 px-2 py-1 text-droid-text transition-colors hover:bg-droid-accent/25"
      >
        Keep mine
      </button>
      <button
        onClick={onTakeTheirs}
        className="rounded-lg px-2 py-1 transition-colors hover:bg-droid-accent/10 hover:text-droid-text"
      >
        Take theirs
      </button>
    </div>
  );
}

/**
 * The agent's version of one file, to read before choosing. It is the revision's
 * own text, so the build's diagnostics for that revision belong on these lines.
 */
export function ConflictCompare({
  path,
  revisionId,
  text,
  issues,
}: {
  path: string;
  revisionId: string;
  /** The file in that revision, or null when the revision deleted it. */
  text: string | null;
  issues: Map<number, SourceIssue[]>;
}) {
  return (
    <section
      aria-label={`${path} in ${revisionId}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1"
    >
      <CompareCaption>Theirs · {revisionId}</CompareCaption>
      {text === null ? (
        <p className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-droid-surface px-3 text-center text-[12px] text-droid-text-secondary">
          Their revision deleted this file. Keep mine writes it back.
        </p>
      ) : (
        <SourceScroller>
          <SourceCode path={path} text={text} issues={issues} />
        </SourceScroller>
      )}
    </section>
  );
}

/** The label over one side of a comparison, so neither pane is guessed at. */
export function CompareCaption({ children }: { children: ReactNode }) {
  return <h3 className="shrink-0 truncate px-1 text-[11px] text-droid-text-muted">{children}</h3>;
}
