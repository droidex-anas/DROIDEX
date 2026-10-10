// The Manage design systems dialog's requests. The list is read when the dialog
// opens and after each save; the selected kit is read whenever it changes.

import { useCallback, useEffect, useReducer, useState } from 'react';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import type { SavedDesignSystem } from './designSystemRequests';
import { designSystemsReducer, initialDesignSystemsState } from './designSystemsState';
import { MAX_KIT_NAME_LENGTH } from './wireValidation';
import type { DesignSystemDetail, DesignSystemSource } from './protocol';

export function useDesignSystems() {
  const [state, dispatch] = useReducer(designSystemsReducer, initialDesignSystemsState);
  const [listAttempt, setListAttempt] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    dispatch({ type: 'listing' });
    canvasClient.designSystems.list().then(
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
    canvasClient.designSystems.read(ref).then(
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

  const showSaved = useCallback((saved: SavedDesignSystem) => {
    dispatch({ type: 'saved', ...saved });
    setListAttempt((attempt) => attempt + 1);
  }, []);

  /** Rejects with the sidecar's reason; the form keeps its text. */
  const create = useCallback(
    async (mutationId: string, name: string, source: DesignSystemSource) => {
      showSaved(await canvasClient.designSystems.import(mutationId, name, source));
    },
    [showSaved],
  );

  /** The caller keeps `mutationId` until an answer, so a click after a lost reply replays. */
  const copy = useCallback(
    async (system: DesignSystemDetail, mutationId: string) => {
      const suffix = ' copy';
      const name = system.name.slice(0, MAX_KIT_NAME_LENGTH - suffix.length) + suffix;
      const source = { id: system.id, version: system.version };
      showSaved(await canvasClient.designSystems.copy(mutationId, source, name));
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
