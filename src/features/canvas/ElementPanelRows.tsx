// The rows the element panel lays its fields out in: a titled section, two
// fields to a row, and a full-width control on the label column the segmented
// controls share.

import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="py-3 first:pt-1">
      <h3 className="pb-2 text-label text-muted">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** Fields two to a row. */
export function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 items-start gap-1.5">{children}</div>;
}

/** A full-width control after its label, and any note under the control. */
export function Labelled({
  label,
  note,
  children,
}: {
  label: string;
  note?: string | false;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-16 shrink-0 truncate text-label text-muted">
          {label}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {/* Under the control: past the label's w-16 and the row's gap-2. */}
      {note && <p className="ml-2 pl-16 text-caption text-quiet">{note}</p>}
    </>
  );
}
