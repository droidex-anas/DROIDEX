import { useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover';

/**
 * One conversation at a time. The orb stays offered on every chat that can
 * hold one, and asks before taking it from the chat that has it: a
 * conversation is being spoken to, so it is never ended without being named.
 */
export default function VoiceTakeoverPopover({
  open,
  onClose,
  anchorRef,
  runningOn,
  onTakeOver,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The chat holding the conversation, as the sidebar names it. */
  runningOn: string;
  onTakeOver: () => void;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-end"
      label="Voice is in use"
      width={272}
    >
      <div className="flex flex-col gap-3 p-3.5">
        <p className="text-body text-primary">
          You are talking to <span className="font-medium">{runningOn}</span>. Starting here ends
          that conversation.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={confirm}
            variant="danger"
            size="sm"
            onClick={() => {
              onClose();
              onTakeOver();
            }}
          >
            End it and start here
          </Button>
        </div>
      </div>
    </Popover>
  );
}
