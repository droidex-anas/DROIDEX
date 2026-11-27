import { useState, type ReactNode } from 'react';

import { CountBadge } from '../../../components/ui/Badge';
import { FoldChevron, PrCollapse } from './PrCollapse';

// Every long stretch of a pull request (description, conflicts, conversation)
// folds from its own header, so a 200-line description never buries the
// conversation. Fold state is local, and the summary is keyed by pull request,
// so switching pull requests rebuilds the sections from their defaults.
export function PrSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="mt-7 first:mt-0">
      {/* A ghost toggle: its text sits on the content edge and the hover fill
          hangs into the gutter, the same line the rail headers start on. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="group -mx-2 flex h-7 min-w-0 select-none items-center gap-1.5 rounded-sm px-2 text-left transition-colors duration-quick hover:bg-elevated"
      >
        <h2 className="truncate text-label text-muted group-hover:text-secondary">{title}</h2>
        {count ? <CountBadge size="sm">{count}</CountBadge> : null}
        <FoldChevron open={open} />
      </button>
      {/* The spacing lives inside the folding panel so a closed section takes
          exactly the height of its header. */}
      <PrCollapse open={open}>
        <div className="pt-2">{children}</div>
      </PrCollapse>
    </section>
  );
}
