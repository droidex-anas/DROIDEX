// A frame's name above its sheet, and the handle that drags it in either mode
// (spec §4). It sits outside the Select overlay, so a drag is always available
// even while the preview owns the pointer. Its tag says when the frame is tagged
// in the chat's next prompt, and tags it from the label; its kit notes badge
// says when a built design strays from its kit.
//
// It is also the keyboard's way onto the board. The labels share one tab stop,
// the frame focus last rested on, and the board moves focus between them with
// the arrows, Home and End in reading order.

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { MessageThread } from '@droidex/icons';
import { Badge } from '../../components/ui/Badge';
import { Tooltip } from '../../components/ui/Tooltip';
import { toast } from '../../lib/toast';
import { TAG_KEY_LABEL } from './boardKeys';
import { canvasMessage } from './client';
import { kitNotes, kitNotesLabel, kitNotesSummary } from './designSystemRule';
import type { CanvasDiagnostic, CanvasFrame } from './protocol';
import { splitVariantName } from './variantRequests';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

const KEYS_HINT = 'Arrows move between frames; ⌥ and an arrow nudge it, ⇧ for ten';

export function FrameLabel({
  ref,
  frame,
  width,
  selected,
  interacted,
  held,
  tagged,
  tabStop,
  onPress,
  onClick,
  onPick,
  onInteract,
  onTagFrames,
  onOpenSource,
  onEnter,
  onFocusLabel,
}: {
  ref: Ref<HTMLDivElement>;
  frame: CanvasFrame;
  /** Screen pixels the label may take, so a long name ellipsizes. */
  width: number;
  selected: boolean;
  interacted: boolean;
  held: boolean;
  tagged: boolean;
  /** This label holds the frames' one tab stop. */
  tabStop: boolean;
  /** A press on the label, which picks or drags the frame. */
  onPress: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onPick: (frame: CanvasFrame, additive: boolean) => void;
  onInteract: (frame: CanvasFrame) => void;
  /** Undefined where frames cannot be tagged; the label then shows no tag. */
  onTagFrames: ((designIds: readonly string[]) => void) | undefined;
  /** Where the kit notes badge takes the user: the frame's source and its issues. */
  onOpenSource: ((designId: string) => void) | undefined;
  onEnter: (frame: CanvasFrame) => void;
  onFocusLabel: (frame: CanvasFrame) => void;
}) {
  const { base, suffix } = splitVariantName(frame.name);
  const notes = kitNotes(frame.build);
  const keysHint = onTagFrames ? `${KEYS_HINT}; ${TAG_KEY_LABEL} toggles its chat tag` : KEYS_HINT;
  // The whole row drags the frame. The header in it is what the keyboard and
  // assistive technology reach, so the kit notes button sits beside it, not in it.
  return (
    <div
      className="canvas-frame-label canvas-chrome"
      style={{ cursor: held ? 'grabbing' : 'grab', width: Math.max(0, width) }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onPress(event);
      }}
      onClick={onClick}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onInteract(frame);
      }}
    >
      <div
        ref={ref}
        data-frame-header
        role="button"
        tabIndex={tabStop ? 0 : -1}
        aria-pressed={selected}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        title={`${frame.name}\n${keysHint}`}
        className="canvas-frame-header"
        onFocus={() => {
          onFocusLabel(frame);
        }}
        // The keyboard's route to spec §4's click: Enter does what the board's
        // mode makes of one, while Space toggles the frame in a multiple selection.
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === ' ') onPick(frame, true);
          else onEnter(frame);
        }}
      >
        {suffix ? (
          <span className="canvas-frame-name canvas-frame-name-split">
            <span className="canvas-frame-name-base">{base}</span>
            <span className="canvas-frame-name-suffix">{suffix}</span>
          </span>
        ) : (
          <span className="canvas-frame-name">{frame.name}</span>
        )}
        {interacted && <span className="canvas-frame-note">Interacting</span>}
        {tagged && <span className="sr-only">, tagged in chat</span>}
      </div>
      {notes.length > 0 && (
        <KitNotesBadge
          notes={notes}
          tabStop={tabStop}
          onOpen={
            onOpenSource &&
            (() => {
              onOpenSource(frame.designId);
            })
          }
        />
      )}
      {onTagFrames && (
        <FrameTag
          tagged={tagged}
          onTag={() => {
            onTagFrames([frame.designId]);
          }}
        />
      )}
    </div>
  );
}

/**
 * Always on a tagged frame, so the board shows what the next prompt carries;
 * on hover otherwise. The keyboard tags with the shortcut, so it is no tab stop.
 */
function FrameTag({ tagged, onTag }: { tagged: boolean; onTag: () => void }) {
  return (
    <Tooltip
      label={tagged ? `Tagged in chat. Untag (${TAG_KEY_LABEL})` : `Tag in chat (${TAG_KEY_LABEL})`}
    >
      <span
        aria-hidden
        data-tagged={tagged || undefined}
        className="canvas-frame-tag"
        // Neither picks nor drags the frame, and leaves focus where it was.
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onTag();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
        }}
      >
        <MessageThread className="size-icon-sm" aria-hidden />
      </span>
    </Tooltip>
  );
}

/**
 * Guide's findings on a frame that built. Where it opens the source it is a
 * button, reached by Tab from the label holding the frames' tab stop; pressing
 * it neither picks nor drags the frame.
 */
function KitNotesBadge({
  notes,
  tabStop,
  onOpen,
}: {
  notes: readonly CanvasDiagnostic[];
  tabStop: boolean;
  onOpen: (() => void) | undefined;
}) {
  const label = kitNotesLabel(notes);
  if (!onOpen)
    return (
      <Tooltip label={kitNotesSummary(notes)}>
        <Badge tone="warning" className="canvas-frame-kit-notes">
          {label}
        </Badge>
      </Tooltip>
    );
  return (
    <Tooltip label={kitNotesSummary(notes)}>
      <button
        type="button"
        data-opens
        tabIndex={tabStop ? 0 : -1}
        aria-label={`${label}. Open source`}
        className="canvas-frame-kit-notes"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
        }}
      >
        <Badge tone="warning">{label}</Badge>
      </button>
    </Tooltip>
  );
}

/**
 * The label while the frame is renamed. Enter or leaving the field saves the
 * name unless someone else renamed the frame meanwhile; Escape keeps the old one.
 */
export function FrameNameField({
  frame,
  width,
  onRename,
  onDone,
}: {
  frame: CanvasFrame;
  width: number;
  onRename: (frame: CanvasFrame, name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [originalName] = useState(frame.name);
  const [name, setName] = useState(frame.name);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    field.current?.select();
  }, []);

  const finish = () => {
    finished.current = true;
    onDone();
  };
  const save = async () => {
    if (pending || finished.current) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === originalName) {
      finish();
      return;
    }
    if (frame.name !== originalName) {
      toast.error(`This frame was renamed to “${frame.name}” meanwhile.`);
      finish();
      return;
    }
    setPending(true);
    try {
      // The live frame: writes and builds move its manifest version too, and
      // only another rename should stop this one.
      await onRename(frame, trimmed);
      finish();
    } catch (error) {
      toast.error(canvasMessage(error));
      setPending(false);
      field.current?.focus();
    }
  };

  return (
    <div className="canvas-frame-label canvas-chrome" style={{ width: Math.max(0, width) }}>
      <input
        ref={field}
        aria-label={`Name of ${originalName}`}
        value={name}
        maxLength={MAX_FRAME_NAME_LENGTH}
        readOnly={pending}
        aria-busy={pending}
        autoFocus
        spellCheck={false}
        className="canvas-frame-name canvas-frame-name-field"
        onChange={(event) => {
          setName(event.target.value);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          } else if (event.key === 'Escape' && !pending) {
            event.preventDefault();
            event.stopPropagation();
            finish();
          }
        }}
        onBlur={() => {
          void save();
        }}
      />
    </div>
  );
}
