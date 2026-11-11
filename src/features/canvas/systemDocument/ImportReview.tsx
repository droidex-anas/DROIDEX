// Under the provenance line of a library kit: how many of the library's files
// the import left out, and, opened, which and why.

import { useId, useState } from 'react';
import { ChevronRight } from '@droidex/icons';
import { cn } from '../../../components/ui/cn';
import type { LibraryProvenance } from '../protocol';
import { importReview } from './importReviewGroups';

export function ImportReview({ library }: { library: LibraryProvenance }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const review = importReview(library);
  if (review === null) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      {/* A ghost control: its text sits on the line's edge and its fill hangs past it. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="-mx-2 flex h-control-sm items-center gap-1 rounded-md px-2 text-label text-muted transition-colors hover:bg-elevated hover:text-secondary aria-expanded:text-secondary"
      >
        {review.label}
        <ChevronRight
          aria-hidden
          className={cn('size-icon-sm shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div id={listId} className="flex w-full flex-col gap-4 rounded-lg bg-surface p-4">
          {review.folder !== null && (
            <p className="text-caption text-muted">From {review.folder}</p>
          )}
          {review.groups.map((group) => (
            <section key={group.reason} aria-label={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-label text-muted">{group.title}</h3>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <li
                    key={`${row.file}:${row.note ?? ''}`}
                    className="flex min-w-0 items-baseline gap-3 py-1"
                  >
                    <span className="min-w-0 truncate text-body text-primary">{row.file}</span>
                    {row.note !== null && (
                      <span className="ml-auto min-w-0 shrink truncate text-caption text-muted">
                        {row.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {review.more > 0 && (
            <p className="text-caption text-muted">And {String(review.more)} more</p>
          )}
        </div>
      )}
    </div>
  );
}
