import type { DesignReference } from '../../types/bridge';
import { designMarkColor, designMarkLabel } from '../browser/designMarks';
import { ChipRemoveButton } from './ChipRemoveButton';

// A mark picked in the browser and staged for the next prompt: its number, a
// crop of it with the mark drawn in, its name and what it is, in the colour of
// its mark on the page. Clicking it writes @N into the draft at the caret.
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
  const color = designMarkColor();

  return (
    <span
      className="group relative flex max-w-56 shrink-0 items-center rounded-lg transition-colors"
      // A tint of the mark's own colour ties the chip to the mark on the page.
      style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <button
        type="button"
        onClick={onInsert}
        title={`${label}${where ? ` (${where})` : ''}. Click to write @${number} in the prompt.`}
        className="flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2.5 text-left"
      >
        <span className="relative size-control-md shrink-0 overflow-hidden rounded-md bg-surface">
          {crop && (
            <img src={crop} alt="" draggable={false} className="h-full w-full object-cover" />
          )}
          <span
            className="absolute left-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-overline tabular-nums text-bg"
            style={{ backgroundColor: color }}
          >
            {number}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-label text-primary">{label}</span>
          <span className="block truncate text-caption text-muted">
            <span style={{ color }}>@{number}</span> · {markDetail(anchor)}
          </span>
        </span>
      </button>
      <ChipRemoveButton title={`Remove @${number}`} onRemove={onRemove} />
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
