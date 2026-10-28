import { useRef, useState } from 'react';
import { Check, ChangesIcon } from '@droidex/icons';
import { Menu } from '../ui/Menu';
import { RowCaret } from '../ui/Row';
import { DIFF_MODES, diffModeLabel } from '../../lib/git';
import type { DiffStatMode, GitDiffStat } from '../../types/vcs';

const ADD_COLOR = 'var(--diff-add-fg)';
const DEL_COLOR = 'var(--diff-del-fg)';

// What the meter sums, phrased as a quiet qualifier next to "Changes"; the
// popover keeps the full mode labels. The default worktree scope gets no
// qualifier — the bare label already means it — and neither does branch mode
// without a resolved base: claiming "vs origin/main" would invent a
// comparison that isn't running.
function modeQualifier(mode: DiffStatMode, baseRef?: string | null): string {
  if (mode === 'branch') return baseRef ? `vs ${baseRef}` : '';
  if (mode === 'uncommitted') return 'uncommitted';
  return '';
}

// The "changes summed up" row. The main button opens the full Review tab; a
// trailing caret switches what the meter sums (worktree / branch / uncommitted).
export function DiffStat({
  stat,
  mode,
  baseRef,
  onModeChange,
  onOpenReview,
}: {
  stat: GitDiffStat | null;
  mode: DiffStatMode;
  baseRef?: string | null;
  onModeChange: (mode: DiffStatMode) => void;
  onOpenReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  // The label switches modes instantly, but `stat` lags until the async refetch
  // resolves. Only trust the counts once they belong to the selected mode.
  const ready = !!stat && stat.mode === mode;
  const additions = stat?.additions ?? 0;
  const deletions = stat?.deletions ?? 0;
  const files = stat?.files ?? 0;
  // Renames, binary edits, and empty-file adds change files without a line
  // delta, so a zero +/- doesn't mean clean — fall back to the file count.
  const clean = files === 0 && additions === 0 && deletions === 0;
  const noLineDelta = additions === 0 && deletions === 0;

  return (
    <>
      <div
        className={`group flex items-center rounded-md transition-colors ${
          open ? 'bg-active' : 'hover:bg-elevated'
        }`}
      >
        <button
          type="button"
          onClick={onOpenReview}
          title="Open the full diff review"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-md px-3 py-2 text-left"
        >
          <span className="flex size-icon-md shrink-0 items-center justify-center text-muted transition-colors group-hover:text-secondary">
            <ChangesIcon className="size-icon-md" />
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-primary">
            Changes
            {modeQualifier(mode, baseRef) !== '' && (
              <span className="text-caption text-muted"> {modeQualifier(mode, baseRef)}</span>
            )}
          </span>
          <span className="shrink-0 text-caption tabular-nums">
            {!ready ? (
              <span className="text-muted/60">…</span>
            ) : clean ? (
              <span className="text-muted">Clean</span>
            ) : noLineDelta ? (
              <span className="text-secondary">
                {files.toLocaleString()} file{files === 1 ? '' : 's'}
              </span>
            ) : (
              <>
                <span style={{ color: ADD_COLOR }}>+{additions.toLocaleString()}</span>{' '}
                <span style={{ color: DEL_COLOR }}>-{deletions.toLocaleString()}</span>
              </>
            )}
          </span>
        </button>
        <button
          ref={caretRef}
          type="button"
          onClick={() => {
            setOpen((v) => !v);
          }}
          title="Choose which changes are counted"
          aria-haspopup="menu"
          aria-expanded={open}
          className="shrink-0 rounded-r-md px-1.5 py-2 text-muted/60 hover:text-primary"
        >
          <RowCaret open={open} />
        </button>
      </div>

      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={caretRef}
        label="Diff mode"
        placement="bottom-end"
        width={224}
      >
        {DIFF_MODES.map((option) => (
          <Menu.Item
            key={option}
            onSelect={() => {
              onModeChange(option);
            }}
          >
            <span className="flex-1 truncate">{diffModeLabel(option, baseRef)}</span>
            {option === mode && <Check aria-hidden="true" className="size-icon-sm text-accent" />}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}
