import { useRef } from 'react';
import { Popover } from '../../components/environment/Popover';

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
      label="Voice is in use"
      width={272}
    >
      <div className="flex flex-col gap-3 p-3.5">
        <p className="text-[13px] leading-relaxed text-droid-text">
          You are talking to <span className="font-medium">{runningOn}</span>. Starting here ends
          that conversation.
        </p>
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text"
          >
            Cancel
          </button>
          <button
            ref={confirm}
            type="button"
            onClick={() => {
              onClose();
              onTakeOver();
            }}
            className="cursor-pointer rounded-lg bg-droid-accent px-2.5 py-1.5 text-[12px] font-medium text-droid-bg transition-opacity hover:opacity-90"
          >
            End it and start here
          </button>
        </div>
      </div>
    </Popover>
  );
}
