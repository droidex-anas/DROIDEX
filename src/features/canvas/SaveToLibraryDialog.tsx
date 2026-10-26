// Save to library (spec §7): the selected frame's current revision, kept under
// a name of the user's choosing. The item outlives the canvas it came from, and
// any canvas can start a frame from it.

import { useId, useRef, useState } from 'react';
import { toast } from '../../lib/toast';
import { canvasClient } from './canvasClient';
import {
  CanvasDialog,
  FIELD_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from './CanvasDialog';
import { canvasMessage, CanvasRequestError } from './client';
import type { RevisionRef } from './protocol';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

export function SaveToLibraryDialog({
  canvasId,
  revision,
  frameName,
  onClose,
}: {
  canvasId: string;
  revision: RevisionRef;
  frameName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(frameName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept until the sidecar answers, so saving again after a lost reply finds
  // the item that save made; a new name is a new item.
  const mutationId = useRef(crypto.randomUUID());
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const nameId = useId();
  const trimmed = name.trim();

  const save = async () => {
    if (pending || trimmed === '') return;
    setPending(true);
    setError(null);
    try {
      await canvasClient.library.save(mutationId.current, canvasId, revision, trimmed);
      toast.success(`Saved “${trimmed}” to the library.`);
      onClose();
    } catch (failure) {
      // A refusal saved nothing, so the next attempt is a new item.
      if (failure instanceof CanvasRequestError) mutationId.current = crypto.randomUUID();
      setError(canvasMessage(failure));
      setPending(false);
    }
  };

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={pending ? null : onClose}
      initialFocus={nameRef}
      className="w-full max-w-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3 p-5"
      >
        <div>
          <h2 id={titleId} className="text-[15px] font-semibold text-droid-text">
            Save to library
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-droid-text-muted">
            Any canvas can start a frame from it, and it stays if this canvas is deleted.
          </p>
        </div>
        <label htmlFor={nameId} className="text-[12px] font-medium text-droid-text">
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          value={name}
          maxLength={MAX_FRAME_NAME_LENGTH}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            mutationId.current = crypto.randomUUID();
          }}
          onFocus={(event) => {
            event.target.select();
          }}
          className={`h-8 ${FIELD_CLASS}`}
        />
        {error && (
          <p role="alert" className="text-[12px] text-droid-red">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={pending} onClick={onClose} className={QUIET_BUTTON_CLASS}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || trimmed === ''}
            className={PRIMARY_BUTTON_CLASS}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </CanvasDialog>
  );
}
