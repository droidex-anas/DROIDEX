import { AudioLines } from 'lucide-react';
import { Button } from '../../components/ui/Button';

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
    <Button
      variant="primary"
      shape="round"
      icon={AudioLines}
      onClick={onClick}
      title="Voice mode"
      aria-label="Start voice mode"
      aria-hidden={parked || undefined}
      tabIndex={parked ? -1 : undefined}
    />
  );
}
