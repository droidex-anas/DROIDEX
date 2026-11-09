// The Canvas wordmark, and the picker it opens: the canvas on screen with what
// can be done to it (tagging in the chat, the library and deletion, spec §4 and
// §7) and its design-system rule, New canvas and the saved ones (spec §4). The
// wordmark stays the label so the row reads the same before and after the list
// is read; the canvas's own name heads the popover. Which chats work on that canvas is the chat column
// header's menu (`AttachedChatsMenu`), beside the transcript they write.

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from '@droidex/icons';
import { navigationIndex } from '../../components/ui/menuKeys';
import { Popover } from '../../components/ui/Popover';
import { toast } from '../../lib/toast';
import { TAG_KEY_LABEL } from './boardKeys';
import { useBoardOnScreen, type BoardOnScreen } from './boardOnScreen';
import { canvasClient, frameRemovals } from './canvasClient';
import { canvasMessage, CanvasRequestError } from './client';
import { DeleteCanvasDialog } from './DeleteCanvasDialog';
import { AUTO_DESIGN_SYSTEM } from './designSystemChoices';
import { DESIGN_SYSTEM_RULES } from './designSystemRule';
import { tagFramesLabel, toggleFramePins, useFramePins } from './framePins';
import { useLeaveDeletedCanvas } from './leaveDeletedCanvas';
import { LibraryPicker } from './LibraryPicker';
import { libraryFrame } from './libraryRequests';
import { MENU_WIDTH_PX, MenuHeading, MenuNote, MenuRadioRow, MenuRow } from './menuRows';
import type {
  CanvasRemovalPreview,
  CanvasSummary,
  DesignSystemAdherence,
  LibraryItem,
  RevisionRef,
} from './protocol';
import { SaveToLibraryDialog } from './SaveToLibraryDialog';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';
import { useOpenCanvas } from './useOpenCanvas';

/** What a dialog acts on, fixed when it opens so a selection change cannot retarget it. */
type MenuDialog =
  | { kind: 'save'; canvasId: string; revision: RevisionRef; frameName: string }
  | { kind: 'insert'; board: BoardOnScreen }
  | { kind: 'delete'; appSessionId: string; canvasId: string };

export function CanvasMenu({
  appSessionId,
  canvasId,
}: {
  /** The chat whose pane shows this canvas. */
  appSessionId: string;
  canvasId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<MenuDialog | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);
  const { openCanvas, startCanvasChat } = useOpenCanvas();
  const leaveDeletedCanvas = useLeaveDeletedCanvas();
  const board = useBoardOnScreen(canvasId);
  // Read only while the picker is open: the list is a request, not pane state.
  const { canvases } = useCanvases(open);
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];
  const canvas = summaries.find((summary) => summary.canvasId === canvasId) ?? null;

  const run = (next: MenuDialog) => {
    close();
    setDialog(next);
  };
  // One list for the arrows, from the canvas's actions through its rule to the
  // saved canvases, wrapping only at its ends.
  const moveBetweenRows = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:enabled'),
    );
    const current = rows.findIndex((row) => row === document.activeElement);
    const next = navigationIndex(event.key, current, rows.length);
    if (next === null) return;
    event.preventDefault();
    rows[next].focus();
  };

  return (
    <div className="flex min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Canvas. Open the canvas picker"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-label text-primary transition-colors hover:bg-elevated/50 focus-visible:bg-elevated/50 focus-visible:outline-none"
      >
        <span className="min-w-0 truncate">Canvas</span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-muted" />
      </button>

      {/* The docked pane clips its overflow, so the picker is portalled and
          hangs from the trigger's right edge like the pane's own tool menu. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-end"
        width={MENU_WIDTH_PX}
        label="Canvas"
      >
        <div
          role="menu"
          aria-label="Canvas"
          className="min-h-0 overflow-y-auto p-1"
          onKeyDown={moveBetweenRows}
        >
          {canvasId !== null && (
            <CanvasActions
              appSessionId={appSessionId}
              canvasId={canvasId}
              name={canvas?.name ?? 'This canvas'}
              board={board}
              onRun={run}
              onDeleteFrames={(shown) => {
                close();
                void frameRemovals.remove(shown.appSessionId, shown.canvasId, shown.selected);
              }}
              onTagFrames={(shown) => {
                close();
                toggleFramePins(shown.appSessionId, shown.canvasId, shown.selected);
              }}
            />
          )}
          {canvasId !== null && canvas && (
            <DesignSystemRuleRows
              appSessionId={appSessionId}
              canvas={canvas}
              board={board}
              onClose={close}
            />
          )}

          <MenuHeading>Saved canvases</MenuHeading>
          <MenuRow
            label="New canvas"
            onRun={() => {
              close();
              startCanvasChat(null);
            }}
          />
          {canvases.status === 'loading' && (
            <MenuNote role="status">Reading saved canvases…</MenuNote>
          )}
          {canvases.status === 'failed' && <MenuNote role="alert">{canvases.message}</MenuNote>}
          {summaries
            .filter((summary) => summary.canvasId !== canvasId)
            .map((summary) => (
              <MenuRow
                key={summary.canvasId}
                label={summary.name}
                onRun={() => {
                  close();
                  openCanvas(summary);
                }}
              />
            ))}
        </div>
      </Popover>
      {dialog && (
        <OpenDialog
          dialog={dialog}
          onClose={closeDialog}
          onDeleted={(deletedFrom, removed) => {
            setDialog(null);
            leaveDeletedCanvas(deletedFrom, removed);
          }}
        />
      )}
    </div>
  );
}

/** What can be done to the canvas on screen, and to the frames selected on it. */
function CanvasActions({
  appSessionId,
  canvasId,
  name,
  board,
  onRun,
  onDeleteFrames,
  onTagFrames,
}: {
  appSessionId: string;
  canvasId: string;
  name: string;
  board: BoardOnScreen | null;
  onRun: (dialog: MenuDialog) => void;
  onDeleteFrames: (board: BoardOnScreen) => void;
  onTagFrames: (board: BoardOnScreen) => void;
}) {
  const selectedCount = board?.selected.length ?? 0;
  // Only a built frame has a revision to save, and each names one frame.
  const frame = board?.selected.length === 1 ? board.selected[0] : null;
  const revision = frame?.revisionId
    ? { designId: frame.designId, revisionId: frame.revisionId }
    : null;
  // Frames land through the chat's attachment, so another chat's canvas takes none.
  const attached = board?.attached ? board : null;
  return (
    <>
      <MenuHeading>{name}</MenuHeading>
      <MenuRow
        label="Save to library…"
        disabled={!frame || !revision}
        onRun={() => {
          if (frame && revision) onRun({ kind: 'save', canvasId, revision, frameName: frame.name });
        }}
      />
      <MenuRow
        label="From library…"
        disabled={!attached}
        onRun={() => {
          if (attached) onRun({ kind: 'insert', board: attached });
        }}
      />
      <TagFramesRow canvasId={canvasId} attached={attached} onTagFrames={onTagFrames} />
      <MenuRow
        label={selectedCount > 1 ? `Delete ${String(selectedCount)} frames` : 'Delete frame'}
        hint="⌫"
        disabled={selectedCount === 0}
        onRun={() => {
          if (board && selectedCount > 0) onDeleteFrames(board);
        }}
      />
      <MenuRow
        label="Delete canvas…"
        onRun={() => {
          onRun({ kind: 'delete', appSessionId, canvasId });
        }}
      />
    </>
  );
}

/** The selected frames, tagged in the board's chat or untagged, as the tag key does. */
function TagFramesRow({
  canvasId,
  attached,
  onTagFrames,
}: {
  canvasId: string;
  /** The board, when its chat is attached to this canvas and so can tag its frames. */
  attached: BoardOnScreen | null;
  onTagFrames: (board: BoardOnScreen) => void;
}) {
  const pins = useFramePins(attached?.appSessionId ?? null);
  const selected = attached?.selected ?? [];
  return (
    <MenuRow
      label={tagFramesLabel(pins, canvasId, selected)}
      hint={TAG_KEY_LABEL}
      disabled={selected.length === 0}
      onRun={() => {
        if (attached && selected.length > 0) onTagFrames(attached);
      }}
    />
  );
}

/**
 * How the canvas holds its designs to their kit. Only an attached chat may
 * change it.
 */
function DesignSystemRuleRows({
  appSessionId,
  canvas,
  board,
  onClose,
}: {
  appSessionId: string;
  canvas: CanvasSummary;
  board: BoardOnScreen | null;
  onClose: () => void;
}) {
  const canChange = canvas.attachedAppSessionIds.includes(appSessionId);
  const usesKit = board?.frames.some(
    (frame) => frame.designSystem.id !== AUTO_DESIGN_SYSTEM.ref.id,
  );
  const choose = (rule: DesignSystemAdherence) => {
    onClose();
    if (rule === canvas.designSystemAdherence) return;
    canvasClient
      .setDesignSystemAdherence(appSessionId, canvas.canvasId, rule)
      .catch((error: unknown) => {
        toast.error(canvasMessage(error));
      });
  };
  return (
    <div role="group" aria-label="Design system">
      <MenuHeading>Design system</MenuHeading>
      {!canChange && <MenuNote>Open a chat on this canvas to change this</MenuNote>}
      {canChange && board && !usesKit && <MenuNote>Checks apply once a design uses a kit</MenuNote>}
      {DESIGN_SYSTEM_RULES.map(({ rule, label, note }) => (
        <MenuRadioRow
          key={rule}
          label={label}
          note={note}
          checked={rule === canvas.designSystemAdherence}
          disabled={!canChange}
          onRun={() => {
            choose(rule);
          }}
        />
      ))}
    </div>
  );
}

/** From library on a board: the picked item lands as a new frame beside the selection. */
function BoardLibraryPicker({ board, onClose }: { board: BoardOnScreen; onClose: () => void }) {
  // One mutation per item until the sidecar answers, so picking it again after
  // a lost reply finds the frame that request placed instead of a second one.
  const attempt = useRef<{ itemId: string; mutationId: string } | null>(null);
  const place = async (item: LibraryItem) => {
    if (attempt.current?.itemId !== item.itemId)
      attempt.current = { itemId: item.itemId, mutationId: crypto.randomUUID() };
    const beside = board.selected.at(0);
    try {
      const created = await canvasClient.createFrames(board.appSessionId, board.canvasId, {
        mutationId: attempt.current.mutationId,
        ...(beside ? { placeBeside: { designId: beside.designId } } : {}),
        frames: [libraryFrame(item)],
      });
      const frame = created.frames.at(0);
      if (frame) board.focusFrame(frame.designId);
    } catch (failure) {
      if (failure instanceof CanvasRequestError) attempt.current = null;
      throw failure;
    }
  };
  return <LibraryPicker canvasId={board.canvasId} onPick={place} onClose={onClose} />;
}

function OpenDialog({
  dialog,
  onClose,
  onDeleted,
}: {
  dialog: MenuDialog;
  onClose: () => void;
  onDeleted: (appSessionId: string, removed: CanvasRemovalPreview) => void;
}) {
  switch (dialog.kind) {
    case 'save':
      return (
        <SaveToLibraryDialog
          canvasId={dialog.canvasId}
          revision={dialog.revision}
          frameName={dialog.frameName}
          onClose={onClose}
        />
      );
    case 'insert':
      return <BoardLibraryPicker board={dialog.board} onClose={onClose} />;
    case 'delete':
      return (
        <DeleteCanvasDialog
          canvasId={dialog.canvasId}
          onClose={onClose}
          onDeleted={(removed) => {
            onDeleted(dialog.appSessionId, removed);
          }}
        />
      );
  }
}
