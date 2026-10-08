// The two ways into a canvas, shared by the Design sidebar, the Design home
// grid and the canvas menu (spec §4).
//
// `openCanvas` shows an existing canvas through a chat already attached to it.
// `startCanvasChat` drafts a fresh chat for a canvas: its first message creates
// the session, and `CanvasChatBootstrap` attaches it once that session exists.

import { useCallback } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useOpenCanvasPane } from './openCanvasPane';
import { recentAttachedChat } from './canvasChats';
import type { CanvasSummary } from './protocol';

export function useOpenCanvas(): {
  /** Opens this canvas, starting a chat on it when none of its chats is loaded here. */
  openCanvas: (summary: CanvasSummary) => void;
  /** Shows `canvasId` through one of the chats already attached to it. */
  showCanvasInChat: (appSessionId: string, canvasId: string) => void;
  /** Drafts a chat for `canvasId`, or for a canvas minted on its first send. */
  startCanvasChat: (canvasId: string | null) => void;
  /** The canvas the chat on screen is working on, so a list can mark it. */
  activeCanvasId: string | null;
} {
  const dispatch = useStoreDispatch();
  const openPane = useOpenCanvasPane();
  const sessions = useStoreSelector((current) => current.sessions);
  const { activeAppSessionId, activeCanvasId } = useStoreSelector((current) => {
    const id = current.activeAppSessionId;
    return {
      activeAppSessionId: id,
      activeCanvasId: id ? (current.canvasAttachments[id] ?? null) : null,
    };
  }, shallowEqual);

  // A design chat is folder-less: designing needs no repository, and a new
  // worktree is a side effect nobody asked for by pressing New canvas.
  const startCanvasChat = useCallback(
    (canvasId: string | null) => {
      dispatch({ type: 'START_CHAT', cwd: '', executionMode: 'local', canvas: { canvasId } });
    },
    [dispatch],
  );

  // Selecting the chat is only half of it: the board has to be opened on that
  // same chat's pane, or the user lands on whatever tool it last showed.
  const showCanvasInChat = useCallback(
    (appSessionId: string, canvasId: string) => {
      if (appSessionId !== activeAppSessionId)
        dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
      openPane({ appSessionId, canvasId });
    },
    [activeAppSessionId, dispatch, openPane],
  );

  const openCanvas = useCallback(
    (summary: CanvasSummary) => {
      const attached = recentAttachedChat(summary, (id) =>
        id in sessions ? sessions[id].updatedAt : undefined,
      );
      // Its own chats are the way in. With none of them here, a fresh chat on
      // the same canvas is the honest alternative to a dead card.
      if (!attached) {
        startCanvasChat(summary.canvasId);
        return;
      }
      showCanvasInChat(attached, summary.canvasId);
    },
    [sessions, showCanvasInChat, startCanvasChat],
  );

  return { openCanvas, showCanvasInChat, startCanvasChat, activeCanvasId };
}
