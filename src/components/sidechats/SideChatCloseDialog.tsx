import { useRef } from 'react';
import { Button } from '../ui/Button';
import { Dialog, DialogActions, DialogTitle } from '../ui/Dialog';

/* Closing a side chat deletes it, so it asks first. Minimizing is the way to
   put one away and come back to it. */

export function SideChatCloseDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      role="alertdialog"
      onClose={onCancel}
      initialFocusRef={cancelRef}
      aria-describedby="side-chat-close-description"
    >
      <DialogTitle>Close this side chat?</DialogTitle>
      <p id="side-chat-close-description" className="mt-3 text-body text-secondary">
        It is deleted and can&apos;t be reopened. Answers you sent to the chat stay there. To put it
        away for later, minimize it instead.
      </p>
      <DialogActions>
        <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Close side chat
        </Button>
      </DialogActions>
    </Dialog>
  );
}
