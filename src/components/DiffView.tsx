import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FileChange, DiffOp } from '../lib/diff';
import { displayPath } from '../lib/pathDisplay';
import { Expand, ToolPanel } from './transcript/primitives';
import { ChangeCount } from './transcript/ChangeCount';

const ADD_FG = 'var(--diff-add-fg)';
const DEL_FG = 'var(--diff-del-fg)';

// Shared review-diff classes: row backgrounds follow the active diff palette,
// and the "focused" diff style adds its colored left-border accent, exactly as
// in the Review tab.
const ROW_TONE: Record<DiffOp['type'], string> = {
  add: 'review-diff-row review-diff-add',
  del: 'review-diff-row review-diff-del',
  ctx: 'review-diff-row',
};

export function DiffLines({ ops }: { ops: DiffOp[] }) {
  return (
    <div className="overflow-x-auto font-mono text-code">
      {/* Sized to the widest line so row tones cover the whole scroll range. */}
      <div className="review-diff-content">
        {ops.map((o, i) => (
          <div key={`${o.type}-${String(i)}`} className={`flex ${ROW_TONE[o.type]}`}>
            <span
              className="w-5 shrink-0 text-center select-none"
              style={{
                color: o.type === 'add' ? ADD_FG : o.type === 'del' ? DEL_FG : 'var(--text-muted)',
              }}
            >
              {o.type === 'add' ? '+' : o.type === 'del' ? '−' : ''}
            </span>
            <span className="whitespace-pre flex-1 px-1 text-secondary">{o.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The rows of a change in a box of fixed height, so a long patch cannot take
// over the surface it sits on. Shared by the transcript's diff card and the
// approval card so both read the same way. The transcript caps the rows and
// says what was left out; `complete` keeps every row, reached by scrolling.
export function DiffPreview({
  ops,
  className,
  complete = false,
}: {
  ops: DiffOp[];
  className?: string;
  complete?: boolean;
}) {
  const preview = complete ? ops : ops.slice(0, PREVIEW_LINES);
  const more = ops.length - preview.length;
  return (
    <ToolPanel className={className}>
      <div className="max-h-56 overflow-auto py-1">
        <DiffLines ops={preview} />
        {more > 0 && (
          <div className="bg-bg/40 px-3 py-1.5 text-caption text-muted">+{more} more lines</div>
        )}
      </div>
    </ToolPanel>
  );
}

const PREVIEW_LINES = 14;

const VERB_LABEL: Record<FileChange['verb'], string> = {
  edit: 'Edit',
  create: 'Create',
  patch: 'Patch',
};

const LIVE_VERB_LABEL: Record<FileChange['verb'], string> = {
  edit: 'Editing',
  create: 'Creating',
  patch: 'Patching',
};

// Shimmers in its live form while the edit is written, then settles into the
// plain verb. Rows that mount settled (history) never animate.
function ChangeVerb({ verb, running }: { verb: FileChange['verb']; running: boolean }) {
  const [mountedRunning] = useState(running);
  if (running) {
    return <span className="shrink-0 shimmer-text text-body-strong">{LIVE_VERB_LABEL[verb]}</span>;
  }
  return (
    <span
      className={`shrink-0 text-body-strong text-secondary${mountedRunning ? ' text-swap-enter' : ''}`}
    >
      {VERB_LABEL[verb]}
    </span>
  );
}

function DiffHeader({ change, cwd }: { change: FileChange; cwd?: string }) {
  const label = displayPath(change.path, cwd);
  return (
    <div className="flex items-center gap-2 px-3 h-9 bg-bg/40 shrink-0">
      <span className="text-label text-secondary shrink-0">{VERB_LABEL[change.verb]}</span>
      <span title={change.path} className="text-caption text-muted truncate flex-1">
        {label}
      </span>
      <span className="text-caption tabular-nums" style={{ color: ADD_FG }}>
        +{change.added}
      </span>
      <span className="text-caption tabular-nums" style={{ color: DEL_FG }}>
        −{change.removed}
      </span>
    </div>
  );
}

export function DiffCard({
  change,
  cwd,
  onOpen,
  running = false,
}: {
  change: FileChange;
  cwd?: string;
  onOpen?: () => void;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = displayPath(change.path, cwd);

  return (
    <div>
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={`Preview ${label}`}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="group flex shrink-0 items-center justify-center"
        >
          <ChevronRight
            className={`size-icon-sm text-muted/50 transition-transform duration-200 group-hover:text-muted ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <button
          type="button"
          aria-expanded={onOpen ? undefined : open}
          onClick={() => {
            if (onOpen) onOpen();
            else setOpen((value) => !value);
          }}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChangeVerb verb={change.verb} running={running} />
          <span title={change.path} className="min-w-0 flex-1 truncate text-caption text-muted">
            {label}
          </span>
          <ChangeCount tone="add" value={change.added} />
          <ChangeCount tone="del" value={change.removed} />
        </button>
      </div>
      <Expand open={open}>
        {open ? <DiffPreview ops={change.ops} className="mt-1.5" /> : null}
      </Expand>
    </div>
  );
}

export function DiffFull({ change, cwd }: { change: FileChange; cwd?: string }) {
  return (
    <div className="flex flex-col h-full">
      <DiffHeader change={change} cwd={cwd} />
      <div className="flex-1 min-h-0 overflow-auto py-1">
        <DiffLines ops={change.ops} />
      </div>
    </div>
  );
}
