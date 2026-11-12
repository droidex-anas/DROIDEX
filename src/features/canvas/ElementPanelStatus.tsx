// The element panel's last line: what Enter and Escape do, that a commit is
// saving, that the element is read only, or why the source could not take
// the last edit. It is always two lines tall, so the fields above never
// change height as it changes; a longer reason is cut there and shows whole
// in a tooltip.

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../components/ui/cn';
import { Tooltip } from '../../components/ui/Tooltip';
import type { ElementEditDraft } from './elementEditDraft';

export function ElementPanelStatus({
  draft,
  editable,
  refusal,
}: {
  draft: ElementEditDraft;
  editable: boolean;
  /** Why the source could not take the last commit; null when it took it or none was made. */
  refusal: string | null;
}) {
  const line = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const shown = line.current;
    setCut(shown !== null && shown.scrollHeight > shown.clientHeight);
  }, [refusal]);
  const status = (
    <p
      ref={line}
      role="status"
      // A cut reason takes the focus, so the keyboard can read it whole too.
      tabIndex={cut ? 0 : undefined}
      className={cn(
        'line-clamp-2 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        refusal ? 'text-danger' : 'text-secondary',
      )}
    >
      {refusal ?? statusText(draft, editable)}
    </p>
  );
  return (
    <div className="grid shrink-0 px-3 pb-3 pt-2 text-caption">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {'\u00a0'}
        <br />
        {'\u00a0'}
      </span>
      <div className="col-start-1 row-start-1 min-w-0">
        {cut && refusal ? (
          <Tooltip label={refusal} className="flex min-w-0">
            {status}
          </Tooltip>
        ) : (
          status
        )}
      </div>
    </div>
  );
}

function statusText(draft: ElementEditDraft, editable: boolean): string {
  if (!editable) return 'Read only.';
  if (draft.pending !== null) return 'Saving…';
  return 'Enter saves your changes; Escape takes one back.';
}
