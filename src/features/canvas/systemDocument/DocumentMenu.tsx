// The document's more menu (spec §10): Duplicate, Export… and, in the user's
// own kits, Delete with Undo.

import { useRef } from 'react';
import { Copy, Download, Trash } from '@droidex/icons';
import { useStoreDispatch } from '../../../hooks/useStore';
import { exportDesignSystem } from '../../../lib/desktop';
import { dismissToast, pushToast } from '../../../lib/toast';
import { canvasClient } from '../canvasClient';
import { canvasMessage, CanvasRequestError } from '../client';
import { forgetDesignSystem } from '../designSystemChoices';
import { MAX_KIT_NAME_LENGTH } from '../designSystemDocumentValidation';
import type { DesignSystemDocumentView } from '../protocol';
import { ActionMenu } from './ActionMenu';
import { useIsMounted } from './useIsMounted';

const COPY_SUFFIX = ' copy';
const UNDO_WINDOW_MS = 8000;

export function DocumentMenu({
  view,
  onDuplicate,
  onBack,
}: {
  view: DesignSystemDocumentView;
  onDuplicate: () => void;
  onBack: () => void;
}) {
  return (
    <ActionMenu
      label={`More actions for ${view.name}`}
      actions={[
        { label: 'Duplicate', icon: Copy, run: onDuplicate },
        {
          label: 'Export…',
          icon: Download,
          run: () => {
            exportKit(view);
          },
        },
        ...(view.kind === 'user'
          ? [
              {
                label: 'Delete',
                icon: Trash,
                danger: true,
                run: () => {
                  deleteKit(view, onBack);
                },
              },
            ]
          : []),
      ]}
    />
  );
}

/** Copies the shown version as a new kit of the user's, “<name> copy”, and opens it. */
export function useDuplicate(view: DesignSystemDocumentView, appSessionId: string): () => void {
  const dispatch = useStoreDispatch();
  // Kept until an answer, so a second click after a lost reply finds the copy already saved.
  const mutationId = useRef(crypto.randomUUID());
  const busy = useRef(false);
  const isMounted = useIsMounted();
  return () => {
    if (busy.current) return;
    busy.current = true;
    const name = view.name.slice(0, MAX_KIT_NAME_LENGTH - COPY_SUFFIX.length) + COPY_SUFFIX;
    canvasClient.designSystems
      .copy(mutationId.current, { id: view.id, version: view.version }, name)
      .then(
        ({ ref }) => {
          mutationId.current = crypto.randomUUID();
          pushToast(`Saved ${name}`, 'success');
          // Opening the copy after the user left this document would override where they went.
          if (!isMounted()) return;
          dispatch({
            type: 'OPEN_UTILITY_TOOL',
            tool: 'canvas',
            appSessionId,
            designSystemId: ref.id,
            designSystemVersion: null,
          });
        },
        (error: unknown) => {
          // A refusal saved nothing, so the next copy is a new one.
          if (error instanceof CanvasRequestError) mutationId.current = crypto.randomUUID();
          pushToast(canvasMessage(error), 'error');
        },
      )
      .finally(() => {
        busy.current = false;
      });
  };
}

function exportKit(view: DesignSystemDocumentView) {
  exportDesignSystem({ id: view.id, version: view.version }).then(
    (exported) => {
      if (exported.ok) pushToast(`Exported ${String(exported.filesWritten)} files`, 'success');
      else if (!('cancelled' in exported)) pushToast(exported.message, 'error');
    },
    (error: unknown) => {
      pushToast(canvasMessage(error), 'error');
    },
  );
}

// Optimistic: the document closes and every canvas that chose the kit returns
// to Auto at once, and a failed delete puts both back.
function deleteKit(view: DesignSystemDocumentView, onBack: () => void) {
  const forgotten = forgetDesignSystem(view.id);
  const setDeleted = (deleted: boolean) =>
    canvasClient.designSystems.setDeleted(crypto.randomUUID(), view.id, deleted);
  onBack();
  const toastId = pushToast(`Deleted ${view.name}`, 'info', UNDO_WINDOW_MS, {
    label: 'Undo',
    run: () => {
      // The choices come back only with the kit, so none names a deleted one.
      setDeleted(false).then(
        () => {
          forgotten.restore();
        },
        (error: unknown) => {
          pushToast(canvasMessage(error), 'error');
        },
      );
    },
  });
  setDeleted(true).catch((error: unknown) => {
    dismissToast(toastId);
    forgotten.restore();
    pushToast(canvasMessage(error), 'error');
  });
}
