// An element's row under its frame in the layers panel: the component it is
// written in with its tag after it, quieter, as the board's hover tag names
// it, indented by how many marked elements hold it. A note row says what an
// open frame's elements cannot show.

import { useEffect, useEffectEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Row, RowCaret } from '../../../components/ui/Row';
import type { PreviewNode } from '../previewDocument';
import type { ElementRef } from '../protocol';
import type { LayerEntry } from './layerRows';

/** Where a row's label starts at level 2, under its frame's name, and each level's step in. */
const LEVEL_TWO_INSET_PX = 38;
const LEVEL_STEP_PX = 14;

export type ElementEntry = Extract<LayerEntry, { kind: 'element' }>;
type NoteEntry = Extract<LayerEntry, { kind: 'note' }>;

export function ElementRow({
  id,
  entry,
  top,
  active,
  picked,
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
  /** The element Edit has picked; this row is selected when it is that one. */
  picked: ElementRef | null;
  onPick: (entry: ElementEntry) => void;
  onToggle: (entry: ElementEntry) => void;
  /** The pointer came onto the row: the board lights its frame and outlines its element. */
  onLight: (designId: string, node: PreviewNode) => void;
  /** The pointer left, or the list scrolled the row away from under it. */
  onUnlight: (designId: string, node: PreviewNode) => void;
}) {
  const { node, component, frame } = entry;
  const selected =
    picked?.designId === frame.designId &&
    picked.elementId === node.elementId &&
    picked.instancePath === node.instancePath;
  const unlight = useEffectEvent(() => {
    onUnlight(frame.designId, node);
  });
  useEffect(
    () => () => {
      unlight();
    },
    [],
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
      aria-label={component ? `${component}, ${node.tagName}` : node.tagName}
      className="group absolute inset-x-0 top-0"
      style={{ transform: `translateY(${String(top)}px)` }}
      onClick={() => {
        onPick(entry);
      }}
      onPointerEnter={() => {
        onLight(frame.designId, node);
      }}
      onPointerLeave={() => {
        onUnlight(frame.designId, node);
      }}
    >
      <Row
        label={
          <>
            {component ?? node.tagName}
            {component && <span className="ml-1.5 text-muted">{node.tagName}</span>}
          </>
        }
        trailing={
          entry.open !== null && (
            <FoldCaret
              open={entry.open}
              onToggle={() => {
                onToggle(entry);
              }}
            />
          )
        }
        data-keyboard-row={active || undefined}
        style={{ paddingLeft: inset(entry.level) }}
        className={cn(
          'cursor-default select-none transition-colors duration-150 ease-out',
          selected ? 'bg-active' : 'group-hover:bg-elevated',
        )}
      />
    </div>
  );
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
  return LEVEL_TWO_INSET_PX + (level - 2) * LEVEL_STEP_PX;
}
