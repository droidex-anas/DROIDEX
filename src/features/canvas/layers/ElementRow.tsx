// An outline row under its frame in the layers panel: its kind's icon and its
// label (an element's text, an instance's component, else its tag), indented
// by how many rows hold it, and a quiet lock saying why it cannot be edited
// here, which the row's description also says. A layer that can move has a
// handle to drag it by, and a right-click opens a written layer's menu. A row
// picks only its own drawn element, and otherwise says why it cannot. A note row says what an open frame's layers cannot show.

import {
  useEffect,
  useEffectEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { GripVertical, Lock } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Row, RowCaret } from '../../../components/ui/Row';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { PreviewNode } from '../previewDocument';
import type { OutlineNode } from '../protocol';
import type { Drawn } from './drawnLayers';
import { layerKind } from './elementKind';
import { rowInset, type LayerEntry } from './layerRows';

const LOCK_REASONS: Record<NonNullable<OutlineNode['lock']>, string> = {
  repeated: 'Written once and repeated for each item. Ask the agent to change it.',
  shared: 'Used in several places. Ask the agent to change it.',
  computed: 'This element’s styles are worked out in code. Ask the agent to change it.',
  kit: 'From the kit.',
};

/** What an element row that cannot pick says: as a tooltip, and after its accessible name. */
const UNPICKABLE: Record<Exclude<Drawn['state'], 'drawn'>, { tip: string; said: string }> = {
  absent: { tip: 'Not drawn right now.', said: 'not drawn' },
  ambiguous: {
    tip: 'Can’t tell which drawn copy this is. Pick it on the board.',
    said: 'copy unknown',
  },
  reading: { tip: 'Reading the preview…', said: 'reading' },
  unread: { tip: 'Couldn’t read where the preview draws this.', said: 'not read' },
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
  describedBy,
  onPick,
  onToggle,
  onGrab,
  onMenu,
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
  /** The id of what tells how to move the layer from the keyboard, where it can move. */
  describedBy: string | undefined;
  onPick: (entry: ElementEntry) => void;
  onToggle: (entry: ElementEntry) => void;
  /** The pointer went down on the row's handle; undefined where its layer cannot move. */
  onGrab: ((event: PointerEvent<HTMLElement>, entry: ElementEntry) => void) | undefined;
  /** A right-click on the row; undefined where its layer has no menu. */
  onMenu: ((event: MouseEvent<HTMLElement>, entry: ElementEntry) => void) | undefined;
  /** The pointer came onto the row: the board lights its frame and outlines its drawn element. */
  onLight: (owner: string, designId: string, target: PreviewNode | null) => void;
  /** The pointer left, or the list scrolled the row away from under it. */
  onUnlight: (owner: string) => void;
}) {
  const { node, frame, drawn } = entry;
  const target = drawn?.state === 'drawn' ? drawn.node : null;
  const unpickable = drawn && drawn.state !== 'drawn' ? UNPICKABLE[drawn.state] : null;
  const { icon: KindIcon, label: kind } = layerKind(node);
  const lockId = `${id}-lock`;
  const unlight = useEffectEvent(() => {
    onUnlight(entry.key);
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
      trailing={<ElementTools entry={entry} onToggle={onToggle} onGrab={onGrab} />}
      data-keyboard-row={active || undefined}
      style={{ paddingLeft: rowInset(entry.level) }}
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
      aria-label={accessibleName(entry, kind, unpickable?.said)}
      aria-describedby={idList(node.lock && lockId, describedBy)}
      className="group absolute inset-x-0 top-0"
      style={{ transform: `translateY(${String(top)}px)` }}
      onClick={() => {
        onPick(entry);
      }}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu(event, entry);
      }}
      onPointerEnter={() => {
        onLight(entry.key, frame.designId, target);
      }}
      onPointerLeave={() => {
        onUnlight(entry.key);
      }}
    >
      {unpickable ? <Unpickable tip={unpickable.tip}>{row}</Unpickable> : row}
      {node.lock && (
        <span id={lockId} className="sr-only">
          {LOCK_REASONS[node.lock]}
        </span>
      )}
    </div>
  );
}

/** The row's handle, which moves its layer, its lock, and the caret that opens its children. */
function ElementTools({
  entry,
  onToggle,
  onGrab,
}: {
  entry: ElementEntry;
  onToggle: (entry: ElementEntry) => void;
  onGrab: ((event: PointerEvent<HTMLElement>, entry: ElementEntry) => void) | undefined;
}) {
  const { lock } = entry.node;
  return (
    <>
      {onGrab && (
        <RowGrip
          last={!lock && entry.open === null}
          onPointerDown={(event) => {
            onGrab(event, entry);
          }}
        />
      )}
      {lock && <LockGlyph lock={lock} last={entry.open === null} />}
      {entry.open !== null && (
        <FoldCaret
          open={entry.open}
          onToggle={() => {
            onToggle(entry);
          }}
        />
      )}
    </>
  );
}

function Unpickable({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip label={tip} placement="right" className="flex w-full">
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

function idList(...ids: (string | null | undefined)[]): string | undefined {
  return ids.filter((id) => id).join(' ') || undefined;
}

/** The row's label, then its kind unless the label already names it, then what stops an edit or a pick. */
function accessibleName(entry: ElementEntry, kind: string, unpickable: string | undefined): string {
  const parts = [entry.name === kind ? kind : `${entry.name}, ${kind}`];
  if (entry.node.lock) parts.push('locked');
  if (unpickable) parts.push(unpickable);
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
        style={{ paddingLeft: rowInset(entry.level) }}
        className="cursor-default select-none"
      />
    </div>
  );
}

/** A row's handle, which drags it to another place in the list. */
export function RowGrip({
  last,
  onPointerDown,
}: {
  /** Nothing comes after it in the row. */
  last: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'canvas-layer-tool -my-1.5 flex size-control-sm shrink-0 cursor-grab items-center justify-center text-muted transition duration-150 ease-out hover:text-secondary',
        last && '-mr-2',
      )}
      onPointerDown={onPointerDown}
    >
      <GripVertical className="size-icon-md" />
    </span>
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
