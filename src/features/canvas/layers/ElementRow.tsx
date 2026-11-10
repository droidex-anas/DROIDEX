// An outline row under its frame in the layers panel: its kind's icon and its
// label (an element's text, an instance's component, else its tag), indented
// by how many rows hold it, and a quiet lock saying why it cannot be edited
// here. A row whose element is not drawn cannot be picked. A note row says
// what an open frame's layers cannot show.

import { useEffect, useEffectEvent, type ReactElement } from 'react';
import { Lock } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Row, RowCaret } from '../../../components/ui/Row';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { PreviewNode } from '../previewDocument';
import type { OutlineNode } from '../protocol';
import { layerKind } from './elementKind';
import type { LayerEntry } from './layerRows';

/** Where a frame row's icon sits, as Row's padding puts it, and each level's step in. */
const LEVEL_ONE_INSET_PX = 12;
const LEVEL_STEP_PX = 12;

const LOCK_REASONS: Record<NonNullable<OutlineNode['lock']>, string> = {
  repeated: 'Written once and repeated for each item. Ask the agent to change it.',
  shared: 'Used in several places. Ask the agent to change it.',
  computed: 'This element’s styles are worked out in code. Ask the agent to change it.',
  kit: 'From the kit.',
};

export type ElementEntry = Extract<LayerEntry, { kind: 'element' }>;
type NoteEntry = Extract<LayerEntry, { kind: 'note' }>;

export function ElementRow({
  id,
  entry,
  top,
  active,
  selected,
  lit,
  onPick,
  onToggle,
  onLight,
  onUnlight,
}: {
  id: string;
  entry: ElementEntry;
  /** Where the row sits in the list, in pixels. */
  top: number;
  /** The keyboard is on this row. */
  active: boolean;
  /** Edit has picked this row's element. */
  selected: boolean;
  /** The pointer is over this row's element on the board. */
  lit: boolean;
  onPick: (entry: ElementEntry) => void;
  onToggle: (entry: ElementEntry) => void;
  /** The pointer came onto the row: the board lights its frame and outlines its drawn element. */
  onLight: (designId: string, target: PreviewNode | null) => void;
  /** The pointer left, or the list scrolled the row away from under it. */
  onUnlight: (designId: string, target: PreviewNode | null) => void;
}) {
  const { node, frame, target } = entry;
  const undrawn = node.elementId !== null && target === null;
  const { icon: KindIcon, label: kind } = layerKind(node);
  const unlight = useEffectEvent(() => {
    onUnlight(frame.designId, target);
  });
  useEffect(
    () => () => {
      unlight();
    },
    [],
  );
  const row = (
    <Row
      icon={<KindIcon className="size-icon-md" />}
      label={entry.name}
      trailing={
        <>
          {node.lock && <LockGlyph lock={node.lock} last={entry.open === null} />}
          {entry.open !== null && (
            <FoldCaret
              open={entry.open}
              onToggle={() => {
                onToggle(entry);
              }}
            />
          )}
        </>
      }
      data-keyboard-row={active || undefined}
      style={{ paddingLeft: inset(entry.level) }}
      className={cn(
        'cursor-default select-none transition-colors duration-150 ease-out',
        selected ? 'bg-active' : cn('group-hover:bg-elevated', lit && 'bg-elevated'),
      )}
    />
  );
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={entry.level}
      aria-posinset={entry.position}
      aria-setsize={entry.count}
      aria-selected={selected}
      aria-expanded={entry.open ?? undefined}
      aria-label={accessibleName(entry, kind, undrawn)}
      className="group absolute inset-x-0 top-0"
      style={{ transform: `translateY(${String(top)}px)` }}
      onClick={() => {
        onPick(entry);
      }}
      onPointerEnter={() => {
        onLight(frame.designId, target);
      }}
      onPointerLeave={() => {
        onUnlight(frame.designId, target);
      }}
    >
      {undrawn ? <NotDrawn>{row}</NotDrawn> : row}
    </div>
  );
}

function NotDrawn({ children }: { children: ReactElement }) {
  return (
    <Tooltip label="Not drawn right now." placement="right" className="flex w-full">
      {children}
    </Tooltip>
  );
}

function LockGlyph({ lock, last }: { lock: NonNullable<OutlineNode['lock']>; last: boolean }) {
  return (
    <Tooltip label={LOCK_REASONS[lock]}>
      <span
        className={cn(
          'canvas-layer-tool -my-1.5 flex size-control-sm items-center justify-center text-muted',
          last && '-mr-2',
        )}
      >
        <Lock className="size-icon-sm" />
      </span>
    </Tooltip>
  );
}

/** The row's label, then its kind unless the label already names it, then what stops a pick or an edit. */
function accessibleName(entry: ElementEntry, kind: string, undrawn: boolean): string {
  const parts = [entry.name === kind ? kind : `${entry.name}, ${kind}`];
  if (entry.node.lock) parts.push('locked');
  if (undrawn) parts.push('not drawn');
  return parts.join(', ');
}

export function NoteRow({
  id,
  entry,
  top,
  active,
}: {
  id: string;
  entry: NoteEntry;
  top: number;
  active: boolean;
}) {
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={entry.level}
      className="absolute inset-x-0 top-0"
      style={{ transform: `translateY(${String(top)}px)` }}
    >
      <Row
        icon={null}
        label={<span className="text-caption text-muted">{entry.name}</span>}
        data-keyboard-row={active || undefined}
        style={{ paddingLeft: inset(entry.level) }}
        className="cursor-default select-none"
      />
    </div>
  );
}

/** The caret that opens or closes a row's children; the keyboard's Right and Left do the same. */
export function FoldCaret({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<RowCaret open={open} />}
      aria-label={open ? 'Collapse' : 'Expand'}
      tabIndex={-1}
      className="-my-1.5 -mr-2"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    />
  );
}

function inset(level: number): number {
  return LEVEL_ONE_INSET_PX + (level - 1) * LEVEL_STEP_PX;
}
