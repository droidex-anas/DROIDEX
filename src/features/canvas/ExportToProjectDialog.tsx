// Export to project: the selected frame's revision written as a standalone
// source tree into an empty folder of the chat's project. The sidecar finds the
// project folder from the chat and keeps the export inside it.

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { exportCanvasToProject } from '../../lib/desktop';
import { toast } from '../../lib/toast';
import { CanvasDialog } from './CanvasDialog';
import { canvasMessage } from './client';
import type { RevisionRef } from './protocol';

/** The folder suggested for a frame: `design/` and its name in lower-case words. */
function projectExportFolder(frameName: string): string {
  const slug = frameName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `design/${slug === '' ? 'frame' : slug}`;
}

export function ExportToProjectDialog({
  appSessionId,
  canvasId,
  revision,
  frameName,
  onClose,
}: {
  appSessionId: string;
  canvasId: string;
  revision: RevisionRef;
  frameName: string;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState(() => projectExportFolder(frameName));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const ended = useRef<AbortSignal | null>(null);
  const titleId = useId();
  const trimmed = folder.trim();

  // Closing the dialog, or anything that unmounts it, cancels the export it runs.
  useEffect(() => {
    const controller = new AbortController();
    ended.current = controller.signal;
    return () => {
      controller.abort();
    };
  }, []);

  // The field was disabled while the export ran; a refusal hands it back to be edited.
  useEffect(() => {
    if (error !== null) folderRef.current?.focus();
  }, [error]);

  const run = async () => {
    const closed = ended.current;
    if (pending || trimmed === '' || closed === null) return;
    setPending(true);
    setError(null);
    const message = await exportCanvasToProject(
      canvasId,
      revision,
      { appSessionId, folder: trimmed },
      closed,
    ).then(
      (result) => {
        if (result.ok) return null;
        // Only closing cancels, and a closed dialog shows nothing, so this is a refusal.
        return 'message' in result ? result.message : 'This design could not be exported.';
      },
      (failure: unknown) => canvasMessage(failure),
    );
    if (closed.aborted) return;
    if (message === null) {
      toast.success(`Exported “${frameName}” to ${trimmed}.`);
      onClose();
      return;
    }
    setError(message);
    setPending(false);
  };

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={onClose}
      initialFocus={folderRef}
      className="w-full max-w-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        aria-busy={pending}
        className="flex flex-col gap-3 p-5"
      >
        <div>
          <h2 id={titleId} className="text-heading text-primary">
            Export to project
          </h2>
          <p className="mt-1 text-label font-normal leading-5 text-muted">
            Writes this design’s source and its design system into a new folder in this chat’s
            project.
          </p>
        </div>
        <Field
          label="Folder in the project"
          hint="A new or empty folder. The README there says how to build it."
          error={error ?? undefined}
        >
          <Input
            ref={folderRef}
            variant="compact"
            value={folder}
            disabled={pending}
            spellCheck={false}
            onChange={(event) => {
              setFolder(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={pending || trimmed === ''}
          >
            Export
          </Button>
        </div>
      </form>
    </CanvasDialog>
  );
}
