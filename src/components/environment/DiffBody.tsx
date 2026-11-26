import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Plus } from '@droidex/icons';
import {
  diffLineAnchorKey,
  parseUnifiedDiff,
  toSplitRows,
  type DiffLine,
  type DiffLineSide,
  type ParsedDiff,
} from '../../lib/unifiedDiff';
import { buildDiffChunks, type DiffRenderRow } from '../../lib/diffRows';
import type { DiffViewMode } from '../../hooks/persistedUiPreferences';

// A line the reader can attach a note to. `text` is the line without its
// +/- marker, so the receiver never has to re-parse the diff row.
export interface DiffLineTarget {
  side: DiffLineSide;
  line: number;
  text: string;
}

// Optional line-review wiring: present in the pull-request diff, absent in
// the local Review tab, which keeps its plain read-only rendering. `anchors`
// names the lines with content below them (`diffLineAnchorKey` format) and
// `renderBelow` produces that content when the row mounts.
export interface DiffLineReview {
  onAnnotate: (target: DiffLineTarget) => void;
  anchors: ReadonlySet<string>;
  renderBelow: (side: DiffLineSide, line: number) => ReactNode;
}

// Shared per-type style objects: a large diff renders thousands of lines, so
// inline object literals would allocate on every line every render.
const SIGN_STYLE: Record<DiffLine['type'], CSSProperties> = {
  add: { color: 'var(--diff-add-fg)' },
  del: { color: 'var(--diff-del-fg)' },
  ctx: { color: 'var(--text-secondary)' },
  meta: { color: 'var(--text-secondary)' },
};
const SIGN: Record<DiffLine['type'], string> = { add: '+', del: '-', ctx: ' ', meta: '' };

const MAX_RENDERED_LINES = 3000;

// Large diffs are mounted in fixed-size chunks: `content-visibility: auto`
// lets the browser skip layout/paint for offscreen chunks, and only a few
// chunks mount per frame so a big file never lands in one synchronous React
// commit (thousands of rows at 5-9 DOM nodes each would drop frames for
// hundreds of ms). The intrinsic-size estimate only seeds the scrollbar; once
// a chunk has rendered, `auto` remembers its real height (wrap included).
const INITIAL_CHUNKS = 3;
const CHUNKS_PER_FRAME = 2;
// The `code` type style: 12px font at a 1.5 line-height by default.
const EST_ROW_PX = 18;

function Gutter({ value }: { value: number | null }) {
  return (
    <span className="review-diff-gutter shrink-0 select-none px-1.5 text-right text-muted/60">
      {value ?? ''}
    </span>
  );
}

function rowClass(type: DiffLine['type']): string {
  if (type === 'add') return 'review-diff-add';
  if (type === 'del') return 'review-diff-del';
  return '';
}

// A unified line annotates the side it belongs to: a deletion the old file,
// anything else the new one — the side whose number a follow-up reads best.
function unifiedAnnotateTarget(line: DiffLine): DiffLineTarget | null {
  if (line.type === 'meta') return null;
  if (line.type === 'del') {
    return line.oldLine == null ? null : { side: 'old', line: line.oldLine, text: line.text };
  }
  return line.newLine == null ? null : { side: 'new', line: line.newLine, text: line.text };
}

function AnnotateButton({
  target,
  onAnnotate,
}: {
  target: DiffLineTarget;
  onAnnotate: DiffLineReview['onAnnotate'];
}) {
  return (
    <button
      type="button"
      data-diff-annotate
      data-diff-line={diffLineAnchorKey(target.side, target.line)}
      aria-label={`Add note on line ${String(target.line)}`}
      title={`Add note on line ${String(target.line)}`}
      // One tab stop per diff, moved by `moveAnnotateTabStop`; React never
      // rewrites this, so the roving stop survives row re-renders.
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onAnnotate(target);
      }}
      className="review-diff-annotate"
    >
      <Plus className="size-icon-sm" aria-hidden="true" />
    </button>
  );
}

// Line rows use only the presence of review wiring and its stable annotate
// callback; anchors and renderBelow belong to separate review rows.
function sameAnnotateReview(
  left: DiffLineReview | undefined,
  right: DiffLineReview | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.onAnnotate === right.onAnnotate;
}

// Memoized: hunk line arrays are stable across parent re-renders (memoized
// parse), so thousands of line rows can skip reconciliation during polling.
const UnifiedLine = memo(
  function UnifiedLine({
    line,
    wrap,
    lineReview,
  }: {
    line: DiffLine;
    wrap: boolean;
    lineReview?: DiffLineReview;
  }) {
    const textClass = wrap ? 'review-diff-code-wrap' : 'review-diff-code';
    if (line.type === 'meta') {
      return (
        <div className="flex text-muted/60">
          <span className="review-diff-meta-gutter shrink-0" />
          <span className={`${textClass} px-2 italic`}>{line.text}</span>
        </div>
      );
    }
    const target = lineReview ? unifiedAnnotateTarget(line) : null;
    return (
      <div className={`review-diff-row flex ${rowClass(line.type)}`}>
        {target && lineReview ? (
          <AnnotateButton target={target} onAnnotate={lineReview.onAnnotate} />
        ) : null}
        <Gutter value={line.oldLine} />
        <Gutter value={line.newLine} />
        <span className="w-4 shrink-0 select-none text-center" style={SIGN_STYLE[line.type]}>
          {SIGN[line.type]}
        </span>
        <span className={`${textClass} min-w-0 flex-1 px-1 text-secondary`}>
          {line.text || ' '}
        </span>
      </div>
    );
  },
  (prev, next) =>
    prev.line === next.line &&
    prev.wrap === next.wrap &&
    sameAnnotateReview(prev.lineReview, next.lineReview),
);

const SplitCell = memo(
  function SplitCell({
    line,
    side,
    wrap,
    lineReview,
  }: {
    line: DiffLine | null;
    side: 'left' | 'right';
    wrap: boolean;
    lineReview?: DiffLineReview;
  }) {
    if (!line) return <div className="review-split-cell flex min-w-0 bg-bg/30" />;
    const textClass = wrap ? 'review-diff-code-wrap' : 'review-diff-code';
    const isMeta = line.type === 'meta';
    const lineNumber = side === 'left' ? line.oldLine : line.newLine;
    const target: DiffLineTarget | null =
      lineReview && !isMeta && lineNumber != null
        ? {
            side: side === 'left' ? 'old' : 'new',
            line: lineNumber,
            text: line.text,
          }
        : null;
    return (
      <div
        className={`review-split-cell flex min-w-0 ${side === 'left' ? 'review-split-left' : ''} ${rowClass(line.type)}`}
      >
        {target && lineReview ? (
          <AnnotateButton target={target} onAnnotate={lineReview.onAnnotate} />
        ) : null}
        {/* The left pane is the old file, the right pane the new one; a context
            row carries both numbers, so pick by side rather than by line type. */}
        <Gutter value={lineNumber} />
        <span className="w-4 shrink-0 select-none text-center" style={SIGN_STYLE[line.type]}>
          {SIGN[line.type]}
        </span>
        <span
          className={`${textClass} min-w-0 flex-1 px-1 ${
            isMeta ? 'italic text-muted/60' : 'text-secondary'
          }`}
        >
          {line.text || ' '}
        </span>
      </div>
    );
  },
  (prev, next) =>
    prev.line === next.line &&
    prev.side === next.side &&
    prev.wrap === next.wrap &&
    sameAnnotateReview(prev.lineReview, next.lineReview),
);

function RowView({
  row,
  wrap,
  lineReview,
  onExpandFold,
}: {
  row: DiffRenderRow;
  wrap: boolean;
  lineReview?: DiffLineReview;
  onExpandFold: (id: string) => void;
}) {
  if (row.kind === 'header') {
    return <div className="review-diff-hunk px-2 py-0.5 text-code-sm">{row.text}</div>;
  }
  if (row.kind === 'line')
    return <UnifiedLine line={row.line} wrap={wrap} lineReview={lineReview} />;
  if (row.kind === 'review') {
    return (
      <div className="review-diff-review-row">
        {lineReview?.renderBelow(row.side, row.line) ?? null}
      </div>
    );
  }
  if (row.kind === 'fold') {
    return (
      <button
        type="button"
        title="Show unmodified lines"
        aria-label={`Show ${String(row.count)} unmodified lines`}
        onClick={() => {
          onExpandFold(row.id);
        }}
        className="review-diff-fold"
      >
        {row.count} unmodified lines
      </button>
    );
  }
  return (
    <div className="review-split-row">
      <SplitCell line={row.left} side="left" wrap={wrap} lineReview={lineReview} />
      <div className="review-split-divider bg-divider" />
      <SplitCell line={row.right} side="right" wrap={wrap} lineReview={lineReview} />
    </div>
  );
}

function sameRow(left: DiffRenderRow, right: DiffRenderRow): boolean {
  if (left === right) return true;
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.kind === 'header') return right.kind === 'header' && left.text === right.text;
  if (left.kind === 'line') return right.kind === 'line' && left.line === right.line;
  if (left.kind === 'split') {
    return right.kind === 'split' && left.left === right.left && left.right === right.right;
  }
  if (left.kind === 'fold') return right.kind === 'fold' && left.count === right.count;
  return right.kind === 'review' && left.side === right.side && left.line === right.line;
}

function sameRows(left: DiffRenderRow[], right: DiffRenderRow[]): boolean {
  return left.length === right.length && left.every((row, index) => sameRow(row, right[index]));
}

// Memoized so polling-driven parent re-renders skip every already-mounted
// chunk. The comparison is structural because injecting one review row rebuilds
// the chunk arrays without touching the diff row objects or their identities.
const Chunk = memo(
  function Chunk({
    rows,
    wrap,
    lineReview,
    onExpandFold,
  }: {
    rows: DiffRenderRow[];
    wrap: boolean;
    lineReview?: DiffLineReview;
    onExpandFold: (id: string) => void;
  }) {
    return (
      <div
        style={{
          contentVisibility: 'auto',
          // Height only: the body is sized to its widest line
          // (`review-diff-content`), which asks every chunk for its intrinsic
          // width, and a skipped chunk would answer with this row-height
          // estimate. Width stays `none`, so a skipped chunk claims no width
          // and still stretches to the body like any auto-width block.
          containIntrinsicHeight: `auto ${String(Math.round(rows.length * EST_ROW_PX))}px`,
        }}
      >
        {rows.map((row) => (
          <RowView
            key={row.id}
            row={row}
            wrap={wrap}
            lineReview={lineReview}
            onExpandFold={onExpandFold}
          />
        ))}
      </div>
    );
  },
  (prev, next) => {
    if (prev.wrap !== next.wrap || prev.onExpandFold !== next.onExpandFold) return false;
    if (!sameRows(prev.rows, next.rows)) return false;
    if (prev.lineReview === next.lineReview) return true;
    // A chunk carrying review rows must see a new renderBelow closure; chunks
    // without one use review wiring only for the stable annotate callback.
    if (prev.rows.some((row) => row.kind === 'review')) return false;
    return sameAnnotateReview(prev.lineReview, next.lineReview);
  },
);

// The annotate buttons are one roving tab stop: Tab enters the diff at the
// last focused line and leaves it in one step, instead of visiting thousands
// of lines.
function moveAnnotateTabStop(root: HTMLElement, button: HTMLElement) {
  for (const stop of root.querySelectorAll<HTMLElement>('[data-diff-annotate][tabindex="0"]')) {
    if (stop !== button) stop.tabIndex = -1;
  }
  button.tabIndex = 0;
}

function ensureAnnotateTabStop(root: HTMLElement) {
  if (root.querySelector('[data-diff-annotate][tabindex="0"]')) return;
  const first = root.querySelector<HTMLElement>('[data-diff-annotate]');
  if (first) first.tabIndex = 0;
}

// Arrow keys move between the per-line annotate buttons imperatively, so the
// keyboard path through a long file does not cost a React render per step:
// focus itself is the cursor, and the browser scrolls it into view.
function focusSiblingAnnotateButton(root: HTMLElement, key: string): boolean {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.hasAttribute('data-diff-annotate')) return false;
  const buttons = Array.from(root.querySelectorAll('[data-diff-annotate]'));
  const index = buttons.indexOf(active);
  if (index < 0) return false;
  const next = buttons[index + (key === 'ArrowDown' ? 1 : -1)];
  if (!(next instanceof HTMLElement)) return false;
  next.focus();
  return true;
}

export function DiffBody({
  diff,
  view,
  binary,
  wrap = false,
  lineReview,
  parsed: given,
}: {
  diff: string;
  view: DiffViewMode;
  binary?: boolean;
  wrap?: boolean;
  lineReview?: DiffLineReview;
  // A parse of this exact diff text, when the caller already made one — the
  // pull-request patch splitter counts lines by parsing, and the body must
  // not parse the same text again.
  parsed?: ParsedDiff;
}) {
  const parsed = useMemo(() => given ?? parseUnifiedDiff(diff), [given, diff]);

  // Every diff line becomes several DOM nodes, so a huge diff (generated file,
  // lockfile) would freeze the renderer; cap what we mount and say so.
  const { hunks, hiddenLines } = useMemo(() => {
    let total = 0;
    for (const hunk of parsed.hunks) total += hunk.lines.length;
    if (total <= MAX_RENDERED_LINES) return { hunks: parsed.hunks, hiddenLines: 0 };
    let budget = MAX_RENDERED_LINES;
    const capped: typeof parsed.hunks = [];
    for (const hunk of parsed.hunks) {
      if (budget <= 0) break;
      // A cut hunk keeps its original @@ header, whose line counts no longer
      // match what is rendered (and a replacement block may lose its add side);
      // flag it so the header doesn't claim to be complete.
      capped.push(
        hunk.lines.length <= budget
          ? hunk
          : { ...hunk, header: `${hunk.header} (truncated)`, lines: hunk.lines.slice(0, budget) },
      );
      budget -= hunk.lines.length;
    }
    return { hunks: capped, hiddenLines: total - MAX_RENDERED_LINES };
  }, [parsed]);

  // Pairing rows for split view is O(lines); memoize per hunk so polling-driven
  // re-renders don't recompute it on every frame.
  const splitRows = useMemo(
    () => (view === 'split' ? hunks.map((hunk) => toSplitRows(hunk.lines)) : null),
    [view, hunks],
  );

  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set());
  const expandFold = useCallback((id: string) => {
    setExpandedFolds((current) => new Set(current).add(id));
  }, []);

  const anchors = lineReview?.anchors;
  const chunks = useMemo(
    () => buildDiffChunks({ hunks, splitRows, anchors, expandedFolds }),
    [hunks, splitRows, anchors, expandedFolds],
  );

  // Progressive mount: start with a few chunks and add a couple per frame until
  // the whole diff is in the DOM. Only diff content or the view restarts it;
  // review rows and folds never push already-mounted work back to zero.
  const [mounted, setMounted] = useState(INITIAL_CHUNKS);
  const [mountSource, setMountSource] = useState({ hunks, view });
  if (mountSource.hunks !== hunks || mountSource.view !== view) {
    setMountSource({ hunks, view });
    setMounted(INITIAL_CHUNKS);
    setExpandedFolds(new Set());
  }
  useEffect(() => {
    if (mounted >= chunks.length) return;
    const raf = requestAnimationFrame(() => {
      setMounted((value) => value + CHUNKS_PER_FRAME);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [mounted, chunks.length]);

  const pendingRows = chunks.slice(mounted).reduce((total, chunk) => total + chunk.length, 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const hasLineReview = lineReview !== undefined;
  useEffect(() => {
    if (hasLineReview && rootRef.current) ensureAnnotateTabStop(rootRef.current);
  }, [hasLineReview, mounted, chunks]);

  if (binary || parsed.binary) {
    return <div className="p-4 text-body text-muted">Binary file not shown</div>;
  }
  if (parsed.hunks.length === 0) {
    return <div className="p-4 text-body text-muted">No textual changes</div>;
  }

  return (
    // Wrapped rows already fit the viewport; only the scrolling mode needs the
    // widest-line width that keeps row backgrounds full-width.
    <div
      ref={rootRef}
      className={`font-mono text-code ${wrap ? '' : 'review-diff-content'}`}
      onFocus={(event) => {
        if (event.target.hasAttribute('data-diff-annotate')) {
          moveAnnotateTabStop(event.currentTarget, event.target);
        }
      }}
      onKeyDown={(event) => {
        if (lineReview && focusSiblingAnnotateButton(event.currentTarget, event.key)) {
          event.preventDefault();
        }
      }}
    >
      {chunks.slice(0, mounted).map((chunk, index) => (
        <Chunk
          key={index}
          rows={chunk}
          wrap={wrap}
          lineReview={lineReview}
          onExpandFold={expandFold}
        />
      ))}
      {/* Placeholder for not-yet-mounted chunks so the scroll height is stable
          while the progressive mount catches up. */}
      {pendingRows > 0 && <div style={{ height: Math.round(pendingRows * EST_ROW_PX) }} />}
      {hiddenLines > 0 && (
        <div className="px-3 py-2 text-caption text-muted">
          Diff truncated: {hiddenLines.toLocaleString()} more lines not shown
        </div>
      )}
    </div>
  );
}
