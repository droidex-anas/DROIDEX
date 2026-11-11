import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../components/ui/cn';

/**
 * Where a dragged row would drop in the layers list: a line along the row
 * boundary from `left`, in the danger colour with what refuses the drop there.
 */
export function LayerDropLine({
  top,
  left,
  refusal,
}: {
  top: number;
  left: number;
  refusal: string | null;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute right-0" style={{ top, left }}>
      <div
        className={cn(
          'h-0.5 -translate-y-px rounded-full',
          refusal === null ? 'bg-selection' : 'bg-danger',
        )}
      />
      {refusal !== null && (
        // The badge's soft fill would let the rows under it show through.
        <span className="absolute right-0 top-1 rounded-full bg-surface">
          <Badge tone="danger">{refusal}</Badge>
        </span>
      )}
    </div>
  );
}
