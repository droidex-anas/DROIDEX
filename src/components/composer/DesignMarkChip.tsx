import { X } from 'lucide-react';
import type { DesignReference } from '../../types/bridge';
import { designMarkLabel } from '../browser/designMarks';

// A mark picked in the browser and staged for the next prompt: its number, a
// crop of it with the mark drawn in, its name and what it is. Clicking it
// writes @N into the draft at the caret.
export function DesignMarkChip({
  mark,
  onInsert,
  onRemove,
}: {
  mark: DesignReference;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const { anchor } = mark;
  const number = String(anchor.mark ?? '');
  const label = designMarkLabel(mark);
  const source = anchor.source;
  const where = source?.file ? `${source.file}${source.line ? `:${String(source.line)}` : ''}` : '';
  const crop = mark.screenshot?.base64 ? `data:image/png;base64,${mark.screenshot.base64}` : '';

  return (
    <span className="group relative flex max-w-56 shrink-0 items-center rounded-xl border border-droid-border bg-droid-bg/60 transition-colors hover:border-droid-border-hover">
      <button
        type="button"
        onClick={onInsert}
        title={`${label}${where ? ` (${where})` : ''}. Click to write @${number} in the prompt.`}
        className="flex min-w-0 items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
      >
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-droid-border bg-droid-surface">
          {crop && (
            <img src={crop} alt="" draggable={false} className="h-full w-full object-cover" />
          )}
          <span className="absolute left-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-droid-accent px-1 text-[9px] font-semibold leading-none text-droid-bg">
            {number}
          </span>
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12px] font-medium text-droid-text">{label}</span>
          <span className="block truncate text-[11px] text-droid-text-muted">
            @{number} · {markDetail(anchor)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-droid-border bg-droid-raised text-droid-text-muted shadow-sm transition-colors after:absolute after:-inset-0.5 after:content-[''] hover:border-droid-border-hover hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
        title={`Remove @${number}`}
      >
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </button>
    </span>
  );
}

// The tag of an element, the strokes of a sketch, the size of an area.
function markDetail(anchor: DesignReference['anchor']): string {
  if (anchor.kind === 'element') return anchor.tag ?? 'element';
  const strokes = anchor.strokes?.length ?? 0;
  if (strokes > 0) return `${String(strokes)} stroke${strokes === 1 ? '' : 's'}`;
  return `${String(anchor.box.width)} × ${String(anchor.box.height)}`;
}
