import { VisualizeTile } from './icons/VisualizeIcon';

export function AppLoadingSurface({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      className="flex min-h-16 items-center gap-3 py-3 text-droid-text-secondary"
    >
      <VisualizeTile />
      <span className="shimmer-text text-[13px] font-medium">{title}</span>
    </div>
  );
}
