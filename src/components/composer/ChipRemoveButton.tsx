import { X } from 'lucide-react';

// The corner badge that takes a staged chip off the draft. Its hit area reaches
// a little past the 16px badge so the corner is easy to land on.
export function ChipRemoveButton({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-raised text-muted shadow-sm transition-colors after:absolute after:-inset-0.5 hover:text-primary"
      title={title}
    >
      <X className="size-2.5" strokeWidth={3} />
    </button>
  );
}
