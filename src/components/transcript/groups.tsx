import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TranscriptEvent } from '../../types/bridge';
import type { ToolActivityDensity } from '../../lib/toolActivity';
import {
  MAX_DIFF_CARDS_PER_COMMIT,
  createDiffDisclosure,
  mountNextRevealedDiffCards,
  reopenDiffDisclosure,
  revealNextDiffCards,
  type FileChange,
} from '../../lib/diff';
import { pathFileName } from '../../lib/pathDisplay';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';
import { formatDuration } from '../../lib/tools';
import type { FeedChange, FeedItem } from '../chatFeed';
import { DiffCard } from '../DiffView';
import { Caret, Expand } from './primitives';
import { ChangeCount } from './ChangeCount';
import { Button } from '../ui/Button';
import { hasPendingCall, renderToolEvents, summarizeTools } from './rows';

/* ── One run of tool calls at the configured density. Compact folds the run to
   a single aggregate line ("Explored 4 files, 1 search") that expands to the
   per-tool lines; balanced shows one line per tool, each expanding to its body;
   detailed renders the bodies inline. ── */
export function ToolGroupItem({
  events,
  active = false,
  sessionLive = active,
  density = 'balanced',
  onOpenReviewFile,
}: {
  events: TranscriptEvent[];
  active?: boolean;
  // A call without its result is in flight while the session runs, even once
  // a later item (prose, thinking) has become the tail and `active` is off.
  sessionLive?: boolean;
  density?: ToolActivityDensity;
  onOpenReviewFile?: OpenReviewFileHandler;
}) {
  const [open, setOpen] = useState(false);
  // The header shimmers and speaks progressively while a call is in flight,
  // even once later prose has taken the tail from this group.
  const inFlight = useMemo(() => hasPendingCall(events, sessionLive), [events, sessionLive]);
  const summary = useMemo(() => summarizeTools(events, inFlight), [events, inFlight]);
  // While the group is live each new row enters with motion (see index.css);
  // a settled group is history and renders still.
  const rows = `space-y-2.5${active ? ' tool-rows-live' : ''}`;
  if (density !== 'compact') {
    return (
      <div className={rows}>
        {renderToolEvents(events, sessionLive, density === 'detailed', onOpenReviewFile)}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex items-center gap-1.5 text-left"
      >
        {inFlight ? (
          <span className="shimmer-text text-body-strong">{summary}</span>
        ) : (
          <span className="text-body text-muted group-hover:text-secondary transition-colors">
            {summary}
          </span>
        )}
        <Caret open={open} />
      </button>
      <Expand open={open}>
        <div className={`mt-2 pl-5 ${rows}`}>
          {renderToolEvents(events, sessionLive, false, onOpenReviewFile)}
        </div>
      </Expand>
    </div>
  );
}

/* ── Worked-for group: a completed turn's steps folded into one disclosure.
   Pure shell — the parent renders each child feed item so this module does not
   depend on the row dispatcher. The header stays a bare "Worked for 12s"; the
   turn's detail belongs inside the fold, rendered at the configured density. ── */
export function WorkedGroup({
  item,
  children,
}: {
  item: Extract<FeedItem, { type: 'worked' }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      // eslint-disable-next-line design-policy/design-tokens -- rules.md lines that carry meaning: marks where the turn's work ends and its answer begins
      className="border-b border-divider pb-1.5"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex h-control-sm min-w-0 items-center gap-1 text-left text-body-lg text-quiet transition-colors duration-150 hover:text-secondary focus-visible:text-secondary"
      >
        <span className="shrink-0">
          Worked
          {item.durationMs >= 1000 && (
            <span className="tabular-nums"> for {formatDuration(item.durationMs)}</span>
          )}
        </span>
        {/* Unlike row carets, always shown: it is the only cue that the turn's steps are folded here. */}
        <ChevronRight
          aria-hidden="true"
          className={`size-icon-sm shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>
      <Expand open={open}>
        <div className="mt-3 space-y-2.5 pl-5">{children}</div>
      </Expand>
    </div>
  );
}

/* ── Folded run of file edits: one collapsible header over individual diffs.
   `inlineDiffs` (the "Show inline code diffs" setting) is the default open
   state; a manual toggle wins over the setting for that row. ── */
export function DiffGroup({
  changes,
  cwd,
  onOpenDiff,
  onOpenReviewFile,
  inlineDiffs = true,
  live = false,
}: {
  changes: FeedChange[];
  cwd?: string;
  onOpenDiff?: (c: FileChange) => void;
  onOpenReviewFile?: OpenReviewFileHandler;
  inlineDiffs?: boolean;
  // The turn is still streaming: edits without a result are being written.
  live?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? inlineDiffs;
  const [disclosure, setDisclosure] = useState(() => createDiffDisclosure(changes.length));
  const added = changes.reduce((s, c) => s + c.change.added, 0);
  const removed = changes.reduce((s, c) => s + c.change.removed, 0);
  const files = new Set(changes.map((c) => c.change.path));
  const edits = `${String(changes.length)} ${changes.length === 1 ? 'edit' : 'edits'}`;
  const writing = live && changes.some((c) => c.pending);
  const verb = writing ? 'Editing' : 'Edited';
  const label =
    files.size <= 1
      ? `${verb} ${pathFileName(changes[0].change.path)} · ${edits}`
      : `${verb} ${String(files.size)} files · ${edits}`;
  // Mount bounded chunks so neither opening nor disclosing a genuinely huge
  // edit run creates one long renderer commit. No diff content is discarded.
  const shown = changes.slice(0, disclosure.mountedCount);
  const hiddenCount = changes.length - shown.length;
  const revealCount = Math.min(MAX_DIFF_CARDS_PER_COMMIT, hiddenCount);
  const canRevealMore = hiddenCount > 0 && disclosure.mountedCount >= disclosure.revealedCount;

  useEffect(() => {
    if (!open || disclosure.mountedCount >= disclosure.revealedCount) return;
    const frame = requestAnimationFrame(() => {
      setDisclosure((current) => mountNextRevealedDiffCards(current, changes.length));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [changes.length, disclosure.mountedCount, disclosure.revealedCount, open]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setDisclosure((current) => reopenDiffDisclosure(current, changes.length));
          }
          setOverride(!open);
        }}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left"
      >
        <span
          className={`min-w-0 truncate text-body-strong ${
            writing ? 'shimmer-text' : 'text-muted group-hover:text-secondary'
          }`}
        >
          {label}
        </span>
        <Caret open={open} />
        <ChangeCount tone="add" value={added} />
        <ChangeCount tone="del" value={removed} />
      </button>
      <Expand open={open}>
        <div className={`mt-2 space-y-2.5 pl-5${live ? ' tool-rows-live' : ''}`}>
          {shown.map((c) => (
            <DiffCard
              key={c.event.id}
              change={c.change}
              running={live && c.pending === true}
              cwd={cwd}
              onOpen={
                onOpenReviewFile
                  ? () => {
                      onOpenReviewFile(c.change.path, c.change);
                    }
                  : onOpenDiff
                    ? () => {
                        onOpenDiff(c.change);
                      }
                    : undefined
              }
            />
          ))}
          {canRevealMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDisclosure((current) => revealNextDiffCards(current, changes.length));
              }}
            >
              Show next {revealCount} {revealCount === 1 ? 'edit' : 'edits'} ({hiddenCount}{' '}
              remaining)
            </Button>
          )}
        </div>
      </Expand>
    </div>
  );
}
