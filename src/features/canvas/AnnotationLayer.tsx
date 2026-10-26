// The annotation layer: one SVG inside the board's transformed world layer, so
// marks pan and zoom with the frames they sit beside. Strokes, handles and the
// author glyph keep their screen size at every zoom. The layer lets the pointer
// through except where Select can take hold of a mark, and the surface below
// takes the board's presses while a drawing tool is armed.

import { useRef, type PointerEvent } from 'react';
import type { AnnotationDraft, AnnotationRect } from './annotationProtocol';
import {
  draftBounds,
  isTextDraft,
  linePath,
  strokePath,
  textSizePx,
  MAX_TEXT_LENGTH,
  type AnnotationHandle,
  type TextDraft,
} from './annotationGeometry';
import type { ShownMark } from './annotationWrites';
import type { MarkGrip } from './useAnnotationEditor';

/** Screen pixels: a mark's stroke, the band around it that takes a press, and its arrowheads. */
const STROKE_PX = 2;
const HIT_PX = 14;
const ARROW_HEAD_PX = 12;
/** Screen pixels between a selected mark and its outline. */
const OUTLINE_GAP_PX = 4;
const HANDLE_PX = 8;

const BOX_HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
const HANDLE_CURSORS: Record<AnnotationHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  start: 'move',
  end: 'move',
};

export interface AnnotationLayerProps {
  marks: ShownMark[];
  selectedId: string | null;
  editingId: string | null;
  scale: number;
  /** Select with no tool armed: a press on a mark takes hold of it. */
  interactive: boolean;
  onMarkPointerDown: (id: string, grip: MarkGrip, event: PointerEvent) => void;
  onEditText: (id: string) => void;
  onCommitText: (text: string) => void;
  onCancelText: () => void;
}

export function AnnotationLayer(props: AnnotationLayerProps) {
  const { marks, selectedId, editingId, scale } = props;
  const selected = marks.find((mark) => mark.draft.id === selectedId);
  return (
    <svg className="canvas-annotations" width={1} height={1} overflow="visible">
      {marks.map((mark) => (
        <Mark key={mark.draft.id} mark={mark} editing={mark.draft.id === editingId} {...props} />
      ))}
      {selected && (
        <Selection
          draft={selected.draft}
          scale={scale}
          reshapable={selected.draft.id !== editingId}
          onMarkPointerDown={props.onMarkPointerDown}
        />
      )}
    </svg>
  );
}

/** The surface a press lands on while a drawing tool is armed, above the frames. */
export function DrawSurface({
  passThrough,
  onPointerDown,
}: {
  /** Space is held, so a press pans instead of drawing. */
  passThrough: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      aria-hidden
      data-draw-surface
      className="canvas-draw-surface"
      style={{ pointerEvents: passThrough ? 'none' : 'auto' }}
      onPointerDown={onPointerDown}
    />
  );
}

function Mark({
  mark: { draft, author },
  editing,
  scale,
  interactive,
  onMarkPointerDown,
  onEditText,
  onCommitText,
  onCancelText,
}: AnnotationLayerProps & { mark: ShownMark; editing: boolean }) {
  const hold = (event: PointerEvent) => {
    onMarkPointerDown(draft.id, 'move', event);
  };
  return (
    <g data-annotation={draft.id} data-kind={draft.kind}>
      {isTextDraft(draft) ? (
        <TextMark
          draft={draft}
          editing={editing}
          interactive={interactive}
          onPointerDown={hold}
          onEdit={() => {
            onEditText(draft.id);
          }}
          onCommit={onCommitText}
          onCancel={onCancelText}
        />
      ) : (
        <StrokedMark draft={draft} scale={scale} interactive={interactive} onPointerDown={hold} />
      )}
      {author.kind === 'agent' && (
        <AuthorGlyph bounds={draftBounds(draft)} scale={scale} interactive={interactive} />
      )}
    </g>
  );
}

/** A shape, line or stroke, with a wider invisible copy of it that takes the press. */
function StrokedMark({
  draft,
  scale,
  interactive,
  onPointerDown,
}: {
  draft: Exclude<AnnotationDraft, TextDraft>;
  scale: number;
  interactive: boolean;
  onPointerDown: (event: PointerEvent) => void;
}) {
  const shape = strokedShape(draft, scale);
  return (
    <>
      <g
        fill="none"
        stroke={`var(--droid-annotation-${draft.color})`}
        strokeWidth={STROKE_PX}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      >
        {shape}
      </g>
      {interactive && (
        <g
          fill="none"
          stroke="transparent"
          strokeWidth={HIT_PX}
          pointerEvents="stroke"
          onPointerDown={onPointerDown}
        >
          {shape}
        </g>
      )}
    </>
  );
}

function strokedShape(draft: Exclude<AnnotationDraft, TextDraft>, scale: number) {
  switch (draft.kind) {
    case 'rect': {
      const { x, y, width, height } = draft.rect;
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={2 / scale}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    case 'ellipse': {
      const { x, y, width, height } = draft.rect;
      return (
        <ellipse
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    case 'line':
      return (
        <path
          d={linePath(draft.points, draft.arrowStart, draft.arrowEnd, ARROW_HEAD_PX / scale)}
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'path':
      return <path d={strokePath(draft.points)} vectorEffect="non-scaling-stroke" />;
  }
}

/** A label or a note, set in a type size its box picks, or the textarea editing it. */
function TextMark({
  draft,
  editing,
  interactive,
  onPointerDown,
  onEdit,
  onCommit,
  onCancel,
}: {
  draft: TextDraft;
  editing: boolean;
  interactive: boolean;
  onPointerDown: (event: PointerEvent) => void;
  onEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const { x, y, width, height } = draft.rect;
  return (
    <foreignObject x={x} y={y} width={width} height={height} overflow="visible">
      <div
        className="canvas-annotation-text"
        data-kind={draft.kind}
        style={{
          fontSize: textSizePx(draft),
          color: draft.kind === 'text' ? `var(--droid-annotation-${draft.color})` : undefined,
          background:
            draft.kind === 'note' ? `var(--droid-annotation-${draft.color}-fill)` : undefined,
          pointerEvents: interactive || editing ? 'auto' : 'none',
        }}
        onPointerDown={editing ? undefined : onPointerDown}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!editing) onEdit();
        }}
      >
        {editing ? (
          <TextEditor text={draft.text} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          draft.text
        )}
      </div>
    </foreignObject>
  );
}

/** A plain textarea over the mark: blur or ⌘↵ saves, Escape puts the text back. */
function TextEditor({
  text,
  onCommit,
  onCancel,
}: {
  text: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  // Escape and ⌘↵ settle the edit before the field's blur would save it again.
  const settled = useRef(false);
  return (
    <textarea
      aria-label="Annotation text"
      className="canvas-annotation-editor"
      defaultValue={text}
      maxLength={MAX_TEXT_LENGTH}
      ref={(field) => {
        // A focused field must not scroll the clipped board under its transform.
        if (!field || document.activeElement === field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(field.value.length, field.value.length);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          settled.current = true;
          onCancel();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          settled.current = true;
          onCommit(event.currentTarget.value);
        }
      }}
      onBlur={(event) => {
        if (!settled.current) onCommit(event.currentTarget.value);
      }}
    />
  );
}

/** A small mark at the top right of what an agent drew, which names its author. */
function AuthorGlyph({
  bounds,
  scale,
  interactive,
}: {
  bounds: AnnotationRect;
  scale: number;
  interactive: boolean;
}) {
  const x = bounds.x + bounds.width;
  return (
    <g
      data-author-glyph
      transform={`translate(${String(x)} ${String(bounds.y)}) scale(${String(1 / scale)})`}
      pointerEvents={interactive ? 'all' : 'none'}
    >
      <title>Drawn by the agent</title>
      <circle cx={10} cy={-10} r={9} className="canvas-annotation-glyph" />
      <path
        d="M10 -15.5 Q10.8 -10.8 15.5 -10 Q10.8 -9.2 10 -4.5 Q9.2 -9.2 4.5 -10 Q9.2 -10.8 10 -15.5Z"
        fill="var(--droid-text-secondary)"
      />
    </g>
  );
}

/** The selected mark's outline and the handles that reshape it, at screen size. */
function Selection({
  draft,
  scale,
  reshapable,
  onMarkPointerDown,
}: {
  draft: AnnotationDraft;
  scale: number;
  /** False while the mark's text is being typed: the outline stays, the handles go. */
  reshapable: boolean;
  onMarkPointerDown: AnnotationLayerProps['onMarkPointerDown'];
}) {
  const handle = (grip: AnnotationHandle, x: number, y: number) => (
    <rect
      key={grip}
      data-annotation-handle={grip}
      x={x - HANDLE_PX / 2 / scale}
      y={y - HANDLE_PX / 2 / scale}
      width={HANDLE_PX / scale}
      height={HANDLE_PX / scale}
      rx={2 / scale}
      className="canvas-annotation-handle"
      vectorEffect="non-scaling-stroke"
      style={{ cursor: HANDLE_CURSORS[grip] }}
      onPointerDown={(event) => {
        onMarkPointerDown(draft.id, grip, event);
      }}
    />
  );
  if (draft.kind === 'line') {
    const [start, end] = draft.points;
    return (
      <g data-annotation-selection={draft.id}>
        {handle('start', start.x, start.y)}
        {handle('end', end.x, end.y)}
      </g>
    );
  }
  const gap = OUTLINE_GAP_PX / scale;
  const { x, y, width, height } = draftBounds(draft);
  const box = { x: x - gap, y: y - gap, width: width + gap * 2, height: height + gap * 2 };
  return (
    <g data-annotation-selection={draft.id}>
      <rect
        {...box}
        rx={3 / scale}
        className="canvas-annotation-outline"
        vectorEffect="non-scaling-stroke"
      />
      {reshapable &&
        draft.kind !== 'path' &&
        BOX_HANDLES.map((grip) =>
          handle(
            grip,
            grip === 'nw' || grip === 'sw' ? box.x : box.x + box.width,
            grip === 'nw' || grip === 'ne' ? box.y : box.y + box.height,
          ),
        )}
    </g>
  );
}
