import { AudioLines } from 'lucide-react';

/** The composer's idle action, a solid circle twinned with the send button.
    The action slot parks it offstage once the draft has content; parked
    removes it from focus and hit-testing while the swap animates. */
export function VoiceButton({
  parked = false,
  onClick,
}: {
  parked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Voice mode"
      aria-label="Start voice mode"
      aria-hidden={parked || undefined}
      tabIndex={parked ? -1 : undefined}
      className="grid h-8 w-8 place-items-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-droid-border-hover"
    >
      <AudioLines className="h-4 w-4" />
    </button>
  );
}
