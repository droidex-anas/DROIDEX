// One frame's row in the layers panel: its build's glyph, its name with the
// variant suffix kept whole, and the name field while it is renamed.

import { useEffect, useEffectEvent, type MouseEvent } from 'react';
import { AlertTriangle, CirclePause, Clock, LayoutTemplate, Spinner } from '@droidex/icons';
import { cn } from '../../../components/ui/cn';
import { Row } from '../../../components/ui/Row';
import { canvasActivity } from '../canvasMotion';
import { FrameNameField } from '../FrameNameField';
import type { FrameStatus } from '../previewLabels';
import type { CanvasFrame } from '../protocol';
import { splitVariantName } from '../variantRequests';

const GLYPH = 'size-icon-md';

export function LayerRow({
  id,
  frame,
  stage,
  position,
  count,
  top,
  selected,
  active,
  rename,
  onRenameDone,
  onClick,
  onDoubleClick,
  onLight,
  onUnlight,
}: {
  id: string;
  frame: CanvasFrame;
  stage: FrameStatus['stage'];
  /** Its place among the `count` rows, since only the visible ones mount. */
  position: number;
  count: number;
  /** Where the row sits in the list, in pixels. */
  top: number;
  selected: boolean;
  /** The keyboard is on this row. */
  active: boolean;
  /** Set while the row is renamed: what saves the new name. */
  rename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined;
  onRenameDone: () => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  /** The pointer came onto the row: its frame lights on the board. */
  onLight: () => void;
  /** The pointer left, or the list scrolled the row away from under it. */
  onUnlight: () => void;
}) {
  const unlight = useEffectEvent(onUnlight);
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
      aria-level={1}
      aria-posinset={position}
      aria-setsize={count}
      aria-selected={selected}
      aria-label={`${frame.name}, ${stage ? canvasActivity[stage].label : 'Empty'}`}
      className="group absolute inset-x-0 top-0"
      style={{ transform: `translateY(${String(top)}px)` }}
      onClick={(event) => {
        if (!rename) onClick(event);
      }}
      onDoubleClick={onDoubleClick}
      onPointerEnter={onLight}
      onPointerLeave={onUnlight}
    >
      <Row
        icon={<StatusGlyph stage={stage} />}
        label={
          rename ? (
            <FrameNameField
              frame={frame}
              className="w-full min-w-0 bg-transparent text-body text-primary focus-visible:outline-none"
              onRename={rename}
              onDone={onRenameDone}
            />
          ) : (
            <FrameName name={frame.name} />
          )
        }
        data-keyboard-row={active || undefined}
        // While renamed, the row is the field's filled box, as Input draws one
        // around its affixes: the name stays where the label was, the box rings
        // on focus, and a press on its padding keeps the keyboard in the field.
        onMouseDown={(event) => {
          if (!rename || event.target instanceof HTMLInputElement) return;
          event.preventDefault();
          event.currentTarget.querySelector('input')?.focus();
        }}
        className={cn(
          'cursor-default select-none transition-colors duration-150 ease-out',
          rename && 'field-affix cursor-text bg-field',
          !rename && selected && 'bg-active',
          !rename && !selected && 'group-hover:bg-elevated',
        )}
      />
    </div>
  );
}

/** A long variant name shortens before its suffix, so the variants of one frame still read apart. */
function FrameName({ name }: { name: string }) {
  const { base, suffix } = splitVariantName(name);
  if (!suffix) return name;
  return (
    <span className="flex min-w-0">
      <span className="truncate">{base}</span>
      <span className="shrink-0 whitespace-pre text-secondary">{suffix}</span>
    </span>
  );
}

/** The stage the board shows on the frame, as one glyph. */
function StatusGlyph({ stage }: { stage: FrameStatus['stage'] }) {
  switch (stage) {
    case 'writing':
    case 'building':
      return <Spinner className={cn(GLYPH, 'motion-safe:animate-spin-slow')} aria-hidden />;
    case 'queued':
      return <Clock className={GLYPH} aria-hidden />;
    case 'failed':
      return <AlertTriangle className={cn(GLYPH, 'text-danger')} aria-hidden />;
    case 'cancelled':
      return <CirclePause className={GLYPH} aria-hidden />;
    case 'ready':
    case null:
      return <LayoutTemplate className={GLYPH} aria-hidden />;
  }
}
