// The expanded board's own top row (spec §4), in place of the utility pane's
// tab strip. It exists only while the board is expanded, so `Canvas` is the
// segment it is on and `Chat` is the way back to the docked width — which
// leaves the composer exactly where it is.

import { BrandMark } from '../../components/BrandMark';
import { CanvasMenu } from './CanvasMenu';

export function CanvasHeader({
  appSessionId,
  canvasId,
  onDock,
}: {
  appSessionId: string;
  canvasId: string | null;
  onDock: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <BrandMark size={13} className="shrink-0 text-droid-text" />
      <CanvasMenu appSessionId={appSessionId} canvasId={canvasId} />
      <div className="flex min-w-0 flex-1 items-center justify-end">
        <div
          role="radiogroup"
          aria-label="Board width"
          className="flex items-center gap-0.5 rounded-lg bg-droid-elevated/60 p-0.5"
        >
          <WidthSegment label="Chat" selected={false} onSelect={onDock} />
          <WidthSegment label="Canvas" selected />
        </div>
      </div>
    </div>
  );
}

function WidthSegment({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
        selected
          ? 'bg-droid-raised text-droid-text shadow-droid-sm'
          : 'text-droid-text-muted hover:text-droid-text'
      }`}
    >
      {label}
    </button>
  );
}
