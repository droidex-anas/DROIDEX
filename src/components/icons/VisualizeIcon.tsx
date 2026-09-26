import { Visualize } from '@droidex/icons';

// The Visualize plugin's mark keeps its pink wherever it sits, including muted
// menu rows, so callers only set the size through className.
export function VisualizeIcon({ className }: { className?: string }) {
  return <Visualize className={className} style={{ color: 'var(--droid-visualize-mark)' }} />;
}

// The mark on a pink-tinted squircle, for app cards where it stands in for an
// app icon.
export function VisualizeTile() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-droid-visualize-mark/15">
      <VisualizeIcon className="h-5 w-5" />
    </span>
  );
}
