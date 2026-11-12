// The element panel's last line: what Enter and Escape do, that a commit is
// saving, that the element is read only, or why the source could not take
// the last edit. It always holds the keys' line or more, so the fields above
// never change height as it changes.

import { cn } from '../../components/ui/cn';
import type { ElementEditDraft } from './elementEditDraft';

const KEYS = 'Enter saves your changes; Escape takes one back.';

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
  return (
    <div className="grid shrink-0 px-3 pb-3 pt-2 text-caption">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {KEYS}
      </span>
      <p
        role="status"
        className={cn('col-start-1 row-start-1', refusal ? 'text-danger' : 'text-secondary')}
      >
        {refusal ?? status(draft, editable)}
      </p>
    </div>
  );
}

function status(draft: ElementEditDraft, editable: boolean): string {
  if (!editable) return 'Read only.';
  if (draft.pending !== null) return 'Saving…';
  return KEYS;
}
