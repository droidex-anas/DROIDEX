// A design system's document in the canvas area, in place of the board (spec §4).
// This placeholder names the kit and goes back; the document view replaces it.

import { ArrowLeft } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';

export function DesignSystemDocument({
  system,
  onBack,
}: {
  appSessionId: string;
  canvasKey: string;
  system: { id: string; version?: number };
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-bg p-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack} className="self-start">
        Board
      </Button>
      <p className="px-3 text-body text-secondary">{system.id}</p>
    </div>
  );
}
