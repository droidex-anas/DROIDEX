// Reads one version of a kit's document and keeps it current. The kit is read
// again whenever it changes, moving to the new latest version when the latest
// was on screen. Unsaved edits are not this hook's: documentDraft.ts owns them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../../../lib/bridge';
import { pushToast } from '../../../lib/toast';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import type { DesignSystemDocumentView } from '../protocol';

type DocumentRead =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; view: DesignSystemDocumentView };

export function useDesignSystemDocument(id: string, version: number | undefined) {
  const [read, setRead] = useState<DocumentRead>({ status: 'loading' });
  const shownRef = useRef<DesignSystemDocumentView | null>(null);
  // Only the newest read may land, so a slow answer never replaces a newer one.
  const generationRef = useRef(0);

  const show = useCallback(
    async (target: number | 'latest'): Promise<void> => {
      generationRef.current += 1;
      const generation = generationRef.current;
      try {
        const view = await readDocument(id, target);
        if (generation !== generationRef.current) return;
        shownRef.current = view;
        setRead({ status: 'ready', view });
      } catch (error) {
        if (generation !== generationRef.current) return;
        // A failed read keeps the version on screen.
        if (shownRef.current === null) setRead({ status: 'failed', message: canvasMessage(error) });
        else pushToast(canvasMessage(error), 'error');
      }
    },
    [id],
  );

  useEffect(() => {
    shownRef.current = null;
    setRead({ status: 'loading' });
    void show(version ?? 'latest');
    return () => {
      generationRef.current += 1;
    };
  }, [show, version]);

  useEffect(() => {
    const refresh = () => {
      const shown = shownRef.current;
      const isLatest = shown === null || shown.version === shown.latestVersion;
      void show(isLatest ? 'latest' : shown.version);
    };
    const stopEvents = canvasClient.subscribeDesignSystems((changed) => {
      if (changed === id) refresh();
    });
    // No event reaches a dropped socket, so a reconnect reads the kit again.
    const stopReconnects = bridge.onReconnected(refresh);
    return () => {
      stopEvents();
      stopReconnects();
    };
  }, [id, show]);

  return { read, show };
}

// A read names its version, so the latest comes from the list, which also
// leaves out a deleted kit.
async function readDocument(
  id: string,
  target: number | 'latest',
): Promise<DesignSystemDocumentView> {
  if (target !== 'latest') return canvasClient.designSystems.read({ id, version: target });
  const summary = (await canvasClient.designSystems.list()).find((kit) => kit.id === id);
  if (!summary) throw new Error('This design system is no longer saved.');
  return canvasClient.designSystems.read({ id, version: summary.version });
}
