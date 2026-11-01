// The save bar (spec §6): the draft's change count with Discard and Save, or,
// when another version was saved since the draft's base, Discard mine and Save
// over it. useSaveDraft owns saving; the bar shows it.

import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { pushToast } from '../../../lib/toast';
import { canvasClient } from '../canvasClient';
import { canvasMessage, CanvasRequestError } from '../client';
import { currentDraft, discardDraft, type DocumentDraft } from './documentDraft';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'conflict'; latestVersion: number };

export function useSaveDraft(id: string) {
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const savingRef = useRef(false);
  // A retry after a lost answer reuses the mutation ID, so it finds the version
  // already saved instead of conflicting with it.
  const attemptRef = useRef<{ draft: DocumentDraft; onto: number; mutationId: string } | null>(
    null,
  );

  /**
   * Saves the kit's draft onto the version it was based on or, after a
   * conflict, over the version saved since. The kit's change event then moves
   * a document showing the latest version to the saved one.
   */
  const save = async () => {
    const draft = currentDraft(id);
    if (!draft || savingRef.current) return;
    const baseVersion = state.status === 'conflict' ? state.latestVersion : draft.base.version;
    const attempt = attemptRef.current;
    const mutationId =
      attempt?.draft === draft && attempt.onto === baseVersion
        ? attempt.mutationId
        : crypto.randomUUID();
    attemptRef.current = { draft, onto: baseVersion, mutationId };
    savingRef.current = true;
    setState({ status: 'saving' });
    try {
      await canvasClient.designSystems.save(mutationId, id, baseVersion, {
        name: draft.name,
        cover: draft.cover,
        sections: draft.sections,
      });
      attemptRef.current = null;
      // An edit made while saving stays, as a draft on the version it began from.
      if (currentDraft(id) === draft) discardDraft(id);
      setState({ status: 'idle' });
    } catch (error) {
      if (error instanceof CanvasRequestError) attemptRef.current = null;
      const latestVersion = conflictVersion(error);
      setState(latestVersion === null ? { status: 'idle' } : { status: 'conflict', latestVersion });
      if (latestVersion === null) pushToast(canvasMessage(error), 'error');
    } finally {
      savingRef.current = false;
    }
  };

  const discard = () => {
    discardDraft(id);
    setState({ status: 'idle' });
  };

  return { state, save, discard };
}

/** The newest version, when a save was refused because it is no longer the draft's base. */
function conflictVersion(error: unknown): number | null {
  if (!(error instanceof CanvasRequestError) || error.code !== 'revision_conflict') return null;
  return error.latestVersion ?? null;
}

export function SaveBar({
  count,
  state,
  onSave,
  onDiscard,
}: {
  count: number;
  state: SaveState;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const conflict = state.status === 'conflict' ? state.latestVersion : null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 mx-auto mb-4 flex max-w-2xl items-center gap-2 rounded-lg bg-raised py-2 pl-4 pr-2 shadow-lg"
    >
      <p role="status" className="min-w-0 flex-1 truncate text-body text-primary">
        {conflict === null
          ? `${String(count)} unsaved ${count === 1 ? 'change' : 'changes'}`
          : `v${String(conflict)} was saved while you edited`}
      </p>
      <Button variant="ghost" size="sm" disabled={state.status === 'saving'} onClick={onDiscard}>
        {conflict === null ? 'Discard' : 'Discard mine'}
      </Button>
      <Tooltip label="⌘S">
        <Button
          variant="primary"
          size="sm"
          loading={state.status === 'saving'}
          disabled={state.status === 'saving'}
          aria-keyshortcuts="Meta+S"
          onClick={onSave}
        >
          {conflict === null ? 'Save' : `Save over v${String(conflict)}`}
        </Button>
      </Tooltip>
    </div>
  );
}
