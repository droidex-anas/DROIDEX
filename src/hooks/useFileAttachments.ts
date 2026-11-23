import { discardImage, isDesktop, saveAttachment } from '../lib/desktop';
import { blobToDataUrl } from '../lib/imageFiles';
import { toast } from '../lib/toast';
import { saveImageUnlessStale } from './attachmentStaging';
import { useStagedAttachments } from './useStagedAttachments';

export interface AttachedFile {
  id: string;
  /** Absolute path in the temp attachments dir; this is what the prompt @-mentions. */
  path: string;
  /** The pasted file's original name, for the chip label. */
  name: string;
  /** Composer-intake order, shared with pasted images so mixed drops stay in order. */
  sequence: number;
}

// Mirrors MAX_ATTACHMENT_BYTES in electron/attachments.cjs: checked locally so
// an oversized blob is refused before its base64 payload crosses the bridge.
// Files that exist on disk are attached by reference instead and never hit
// this cap, so it only governs clipboard snapshots.
const MAX_PASTED_FILE_BYTES = 40 * 1024 * 1024;

/**
 * Owns the composer's pasted non-image attachments: PDFs, documents, videos,
 * and any other blob with no path on disk. Files that do have a path are
 * attached by reference through the picker's plain path list instead, so this
 * store only ever holds temp copies it may delete. Lifecycle (sequence-ordered
 * adds, stale-save discard, submit settle) is shared with the image store.
 */
export function useFileAttachments() {
  const {
    items: files,
    additions,
    remove,
    clear,
    clearAndDiscard,
    whenReady,
    clearReady,
    reserveSequence,
    insert,
  } = useStagedAttachments<AttachedFile>(discardImage);

  const addBlob = (file: File, sequence?: number) => {
    if (!isDesktop()) {
      toast.error('File attachments need the desktop app');
      return;
    }
    if (file.size > MAX_PASTED_FILE_BYTES) {
      toast.error('That file is too large to paste. Drop it onto the composer instead.');
      return;
    }
    const seq = reserveSequence(sequence);
    const stamp = additions.stamp();
    const task = (async () => {
      try {
        const dataUrl = await blobToDataUrl(file);
        const path = await saveImageUnlessStale(
          additions,
          stamp,
          () => saveAttachment(file.name, dataUrl),
          discardImage,
        );
        if (path === null) return; // cleared while encoding; fresh file deleted
        const attached = { id: crypto.randomUUID(), path, name: file.name, sequence: seq };
        insert(attached, seq);
      } catch (error) {
        toast.error(
          error instanceof Error && error.message.includes('size limit')
            ? 'That file is too large to paste. Drop it onto the composer instead.'
            : 'Could not attach that file',
        );
      }
    })();
    additions.track(task);
  };

  return { files, addBlob, remove, clear, clearAndDiscard, whenReady, clearReady };
}
