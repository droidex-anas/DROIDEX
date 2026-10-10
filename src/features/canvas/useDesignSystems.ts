// The Manage design systems dialog's requests. The list is read when the dialog
// opens and after each save; the selected kit is read whenever it changes.

import { useCallback, useEffect, useReducer, useState } from 'react';
import { canvasClient } from './canvasClient';
import { reply } from './canvasReply';
import { canvasMessage } from './client';
import { designSystemsReducer, initialDesignSystemsState } from './designSystemsState';
import { MAX_KIT_NAME_LENGTH } from './wireValidation';
import type {
  CanvasDiagnostic,
  DesignSystemDetail,
  DesignSystemSource,
  DesignSystemVersionRef,
} from './protocol';

interface SavedKit {
  ref: DesignSystemVersionRef;
  diagnostics: CanvasDiagnostic[];
}

export function useDesignSystems() {
  const [state, dispatch] = useReducer(designSystemsReducer, initialDesignSystemsState);
  const [listAttempt, setListAttempt] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    dispatch({ type: 'listing' });
    canvasClient
      .request({ type: 'canvas.listDesignSystems', requestId: crypto.randomUUID() })
      .then((event) => reply(event, 'designSystems').systems)
      .then(
        (systems) => {
          if (active) dispatch({ type: 'listed', systems });
        },
        (error: unknown) => {
          if (active) dispatch({ type: 'listFailed', message: canvasMessage(error) });
        },
      );
    return () => {
      active = false;
    };
  }, [listAttempt]);

  const selectedId = state.selected?.id;
  const selectedVersion = state.selected?.version;
  useEffect(() => {
    if (selectedId === undefined || selectedVersion === undefined) return;
    const ref = { id: selectedId, version: selectedVersion };
    let active = true;
    dispatch({ type: 'reading' });
    canvasClient
      .request({ type: 'canvas.readDesignSystem', requestId: crypto.randomUUID(), ref })
      .then((event) => reply(event, 'designSystem').system)
      .then(
        (system) => {
          if (active) dispatch({ type: 'read', system });
        },
        (error: unknown) => {
          if (active) dispatch({ type: 'readFailed', ref, message: canvasMessage(error) });
        },
      );
    return () => {
      active = false;
    };
  }, [selectedId, selectedVersion, readAttempt]);

  const showSaved = useCallback((saved: SavedKit) => {
    dispatch({ type: 'saved', ...saved });
    setListAttempt((attempt) => attempt + 1);
  }, []);

  /** Rejects with the sidecar's reason; the form keeps its text. */
  const create = useCallback(
    async (mutationId: string, name: string, source: DesignSystemSource) => {
      const event = await canvasClient.request({
        type: 'canvas.importDesignSystem',
        requestId: crypto.randomUUID(),
        mutationId,
        name,
        source,
      });
      showSaved(reply(event, 'designSystemSaved'));
    },
    [showSaved],
  );

  /** The caller keeps `mutationId` until an answer, so a click after a lost reply replays. */
  const copy = useCallback(
    async (system: DesignSystemDetail, mutationId: string) => {
      const suffix = ' copy';
      const event = await canvasClient.request({
        type: 'canvas.copyDesignSystem',
        requestId: crypto.randomUUID(),
        mutationId,
        source: { id: system.id, version: system.version },
        name: system.name.slice(0, MAX_KIT_NAME_LENGTH - suffix.length) + suffix,
      });
      showSaved(reply(event, 'designSystemSaved'));
    },
    [showSaved],
  );

  return {
    state,
    dispatch,
    create,
    copy,
    retryList: () => {
      setListAttempt((attempt) => attempt + 1);
    },
    retryRead: () => {
      setReadAttempt((attempt) => attempt + 1);
    },
  };
}
