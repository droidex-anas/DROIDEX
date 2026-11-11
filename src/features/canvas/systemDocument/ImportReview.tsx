// Under the provenance line of a library kit: how many of the library's files
// the import left out or kept with notes, and, opened, which and why.

import { useId, useState } from 'react';
import { ChevronRight } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
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
      {/* Its text sits on the line's edge and its fill hangs past it. */}
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="-mx-2.5"
        labelClassName="flex items-center gap-1"
      >
        {review.label}
        <ChevronRight
          aria-hidden
          className={cn('size-icon-sm shrink-0 transition-transform', open && 'rotate-90')}
        />
      </Button>
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
                  // Both wrap rather than cut, so every name and note reads whole without a pointer.
                  <li key={`${row.file}:${row.note ?? ''}`} className="flex min-w-0 flex-col py-1">
                    <span className="break-words text-body text-primary">{row.file}</span>
                    {row.note !== null && (
                      <span className="break-words text-caption text-muted">{row.note}</span>
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
