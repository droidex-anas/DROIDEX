// The Canvas wordmark, and the picker it opens: the canvas on screen with what
// can be done to it (the library and deletion, spec §7), New canvas, the saved
// ones (spec §4), and Manage design systems (spec §10). The wordmark stays the
// label so the row reads the same before and after the list is read; the
// canvas's own name heads the popover. Which chats work on that canvas is the
// chat column header's menu (`AttachedChatsMenu`), beside the transcript they
// write.

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import { useBoardOnScreen, type BoardOnScreen } from './boardOnScreen';
import { DeleteCanvasDialog } from './DeleteCanvasDialog';
import { LibraryPicker } from './LibraryPicker';
import { MENU_WIDTH_PX, MenuHeading, MenuNote, MenuRow } from './menuRows';
import type { CanvasRemovalPreview, RevisionRef } from './protocol';
import { SaveToLibraryDialog } from './SaveToLibraryDialog';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';
import { useOpenCanvas } from './useOpenCanvas';
import { useManageDesignSystems } from './useManageDesignSystems';

/** What a dialog acts on, fixed when it opens so a selection change cannot retarget it. */
type MenuDialog =
  | { kind: 'save'; canvasId: string; revision: RevisionRef; frameName: string }
  | { kind: 'insert'; board: BoardOnScreen }
  | { kind: 'delete'; canvasId: string };

export function CanvasMenu({ canvasId }: { canvasId: string | null }) {
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
  const designSystems = useManageDesignSystems();
  const board = useBoardOnScreen(canvasId);
  // Read only while the picker is open: the list is a request, not pane state.
  const { canvases } = useCanvases(open);
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];
  const canvas = summaries.find((summary) => summary.canvasId === canvasId) ?? null;
  // Only a built frame has a revision to save, and a save names one frame.
  const savable = board?.selected.length === 1 ? board.selected[0] : null;

  const run = (next: MenuDialog) => {
    close();
    setDialog(next);
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
        className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated/50"
      >
        <span className="min-w-0 truncate">Canvas</span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-droid-text-muted" />
      </button>

      {/* The docked pane clips its overflow, so the picker is portalled and
          hangs from the trigger's right edge like the pane's own tool menu. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="right"
        width={MENU_WIDTH_PX}
        label="Canvas"
      >
        <div role="menu" aria-label="Canvas" className="min-h-0 overflow-y-auto p-1">
          {canvasId !== null && (
            <>
              <MenuHeading>{canvas?.name ?? 'This canvas'}</MenuHeading>
              <MenuRow
                label="Save to library…"
                disabled={!savable?.revisionId}
                onRun={() => {
                  if (!savable?.revisionId) return;
                  run({
                    kind: 'save',
                    canvasId,
                    revision: { designId: savable.designId, revisionId: savable.revisionId },
                    frameName: savable.name,
                  });
                }}
              />
              {/* Frames land through the chat's attachment, so another chat's canvas takes none. */}
              <MenuRow
                label="From library…"
                disabled={!board?.attached}
                onRun={() => {
                  if (board?.attached) run({ kind: 'insert', board });
                }}
              />
              <MenuRow
                label="Delete canvas…"
                onRun={() => {
                  run({ kind: 'delete', canvasId });
                }}
              />
            </>
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

          <MenuHeading>Design systems</MenuHeading>
          <MenuRow
            label="Manage design systems…"
            onRun={() => {
              close();
              designSystems.open();
            }}
          />
        </div>
      </Popover>
      {designSystems.dialog}
      {dialog && (
        <OpenDialog
          dialog={dialog}
          onClose={closeDialog}
          onDeleted={(removed) => {
            setDialog(null);
            leaveDeletedCanvas(removed);
          }}
        />
      )}
    </div>
  );
}

function OpenDialog({
  dialog,
  onClose,
  onDeleted,
}: {
  dialog: MenuDialog;
  onClose: () => void;
  onDeleted: (removed: CanvasRemovalPreview) => void;
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
      return <LibraryPicker board={dialog.board} onClose={onClose} />;
    case 'delete':
      return (
        <DeleteCanvasDialog canvasId={dialog.canvasId} onClose={onClose} onDeleted={onDeleted} />
      );
  }
}

/**
 * A deleted canvas leaves its chats unattached and nothing to show, so its pane
 * closes and the window returns to the Design home.
 */
function useLeaveDeletedCanvas(): (removed: CanvasRemovalPreview) => void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  return useCallback(
    (removed: CanvasRemovalPreview) => {
      for (const appSessionId of removed.attachedAppSessionIds)
        dispatch({ type: 'SET_CANVAS_ATTACHMENT', appSessionId, canvasId: null });
      const state = store.getState();
      const appSessionId = state.activeAppSessionId;
      const pane = utilityPanelForSession(state.utilityPanels, appSessionId);
      const canvasTab = pane.tabs.find((tab) => tab.tool === 'canvas');
      if (appSessionId && canvasTab)
        dispatch({ type: 'CLOSE_UTILITY_TAB', tabId: canvasTab.id, appSessionId });
      if (state.productMode === 'design')
        dispatch({ type: 'START_CHAT', cwd: '', executionMode: 'local' });
      else dispatch({ type: 'SET_PRODUCT_MODE', mode: 'design' });
    },
    [dispatch, store],
  );
}
