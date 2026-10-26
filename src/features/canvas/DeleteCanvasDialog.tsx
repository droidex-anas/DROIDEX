// Delete canvas (spec §7): the user reviews what deleting it would end, then
// confirms that exact review. The sidecar refuses a review the canvas has moved
// past, and the dialog reads it again rather than deleting it unseen.

import { useEffect, useId, useReducer, useRef } from 'react';
import { useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { canvasClient } from './canvasClient';
import { CanvasDialog, QUIET_BUTTON_CLASS } from './CanvasDialog';
import { canvasMessage, CanvasRequestError } from './client';
import { reduceCanvasRemoval, REVIEWING_REMOVAL } from './canvasState';
import type { CanvasRemovalPreview } from './protocol';

const DELETE_BUTTON_CLASS =
  'rounded-lg bg-droid-red/10 px-3 py-1.5 text-[12px] font-semibold text-droid-red transition-colors hover:bg-droid-red/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 disabled:cursor-default disabled:opacity-60';

export function DeleteCanvasDialog({
  canvasId,
  onClose,
  onDeleted,
}: {
  canvasId: string;
  onClose: () => void;
  onDeleted: (removed: CanvasRemovalPreview) => void;
}) {
  const [state, dispatch] = useReducer(reduceCanvasRemoval, REVIEWING_REMOVAL);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (state.status !== 'reviewing') return;
    let active = true;
    canvasClient.removal.preview(canvasId).then(
      (preview) => {
        if (active) dispatch({ type: 'previewed', preview });
      },
      (error: unknown) => {
        if (active) dispatch({ type: 'preview-failed', message: canvasMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [canvasId, state.status]);

  const confirm = () => {
    if (state.status !== 'reviewed') return;
    const reviewed = state.preview;
    dispatch({ type: 'confirm' });
    canvasClient.removal.remove(reviewed).then(
      () => {
        onDeleted(reviewed);
      },
      (error: unknown) => {
        dispatch({
          type: 'remove-failed',
          changed: error instanceof CanvasRequestError && error.code === 'revision_conflict',
          message: canvasMessage(error),
        });
      },
    );
  };

  const preview = state.status === 'reviewed' || state.status === 'removing' ? state.preview : null;
  const notice = state.status === 'reviewing' || state.status === 'reviewed' ? state.notice : null;

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={state.status === 'removing' ? null : onClose}
      initialFocus={cancelRef}
      className="flex w-full max-w-md flex-col gap-3 p-5"
    >
      <h2 id={titleId} className="truncate text-[15px] font-semibold text-droid-text">
        {preview ? `Delete “${preview.name}”?` : 'Delete canvas?'}
      </h2>
      {state.status === 'reviewing' && (
        <p role="status" className="text-[12px] text-droid-text-muted">
          Checking what deleting it would end…
        </p>
      )}
      {state.status === 'unavailable' && (
        <p role="alert" className="text-[12px] text-droid-red">
          {state.message}
        </p>
      )}
      {preview && <RemovalConsequences preview={preview} />}
      {notice && (
        <p role="alert" className="text-[12px] text-droid-red">
          {notice}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          ref={cancelRef}
          type="button"
          disabled={state.status === 'removing'}
          onClick={onClose}
          className={QUIET_BUTTON_CLASS}
        >
          Cancel
        </button>
        {state.status === 'unavailable' ? (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'review-again' });
            }}
            className={QUIET_BUTTON_CLASS}
          >
            Review again
          </button>
        ) : (
          <button
            type="button"
            disabled={state.status !== 'reviewed'}
            onClick={confirm}
            className={DELETE_BUTTON_CLASS}
          >
            {state.status === 'removing' ? 'Deleting…' : 'Delete canvas'}
          </button>
        )}
      </div>
    </CanvasDialog>
  );
}

function RemovalConsequences({ preview }: { preview: CanvasRemovalPreview }) {
  const attached = useStoreSelector(
    (current) => chatNames(current, preview.attachedAppSessionIds),
    sameChats,
  );
  const working = useStoreSelector(
    (current) => chatNames(current, preview.activeTurnAppSessionIds),
    sameChats,
  );
  const building = preview.buildingDesignIds.length;

  return (
    <div className="flex flex-col gap-2 text-[12px] leading-5 text-droid-text-secondary">
      <p>Its frames and their history are deleted. Frames saved to the library stay.</p>
      {attached.length > 0 && (
        <ChatList
          heading={
            attached.length === 1
              ? 'This chat is left without a canvas:'
              : `These ${String(attached.length)} chats are left without a canvas:`
          }
          chats={attached}
        />
      )}
      {working.length > 0 && (
        <ChatList
          heading={
            working.length === 1
              ? 'An agent is working on it now; its turn loses the canvas:'
              : `Agents in ${String(working.length)} chats are working on it now; their turns lose the canvas:`
          }
          chats={working}
        />
      )}
      {building > 0 && (
        <p>
          {building === 1
            ? 'One frame is still building; its build stops.'
            : `${String(building)} frames are still building; their builds stop.`}
        </p>
      )}
    </div>
  );
}

interface NamedChat {
  appSessionId: string;
  name: string;
}

function ChatList({ heading, chats }: { heading: string; chats: NamedChat[] }) {
  return (
    <div>
      <p>{heading}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {chats.map(({ appSessionId, name }) => (
          <li
            key={appSessionId}
            className="truncate rounded-lg bg-droid-accent/[0.07] px-2.5 py-1 text-droid-text"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A chat the session list does not hold belongs to another window, and is still counted. */
function chatNames(state: AppState, appSessionIds: string[]): NamedChat[] {
  return appSessionIds.map((appSessionId) => ({
    appSessionId,
    name:
      appSessionId in state.sessions
        ? chatDisplayTitle(state.sessions[appSessionId], state.chatMetadata[appSessionId])
        : 'A chat in another window',
  }));
}

function sameChats(left: NamedChat[], right: NamedChat[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (chat, index) =>
        chat.appSessionId === right[index].appSessionId && chat.name === right[index].name,
    )
  );
}
