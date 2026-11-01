// How an unsaved change looks against the draft's base (spec §6): a small
// accent dot before the name with what it was in a tooltip, and Undo on what
// was removed. The dot hangs outside the name's row, so names never shift and
// start on the column's edge.

import { Undo } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DraftChange } from './documentDraft';
import type { DraftMark } from './documentSections';

/** The dot, 8px left of the positioned row it is in, which starts where the name does. */
export function UnsavedMark({ mark, was }: { mark: DraftMark | undefined; was?: string }) {
  if (mark !== 'added' && mark !== 'changed') return null;
  const label = mark === 'added' ? 'Added, not saved' : (was ?? 'Changed, not saved');
  return (
    <Tooltip label={label} className="absolute right-full top-1/2 mr-2 -translate-y-1/2">
      <span role="img" aria-label={label} className="size-1.5 rounded-full bg-accent" />
    </Tooltip>
  );
}

/**
 * Puts a removed item back. The document moves focus here when the item is
 * removed. It ends its row, so its padding hangs past the row's edge.
 */
export function UndoRemove({
  label,
  removedKey,
  onChange,
}: {
  label: string;
  removedKey: string;
  onChange: (change: DraftChange) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Undo}
      aria-label={`Undo removing ${label}`}
      data-removed-key={removedKey}
      onClick={() => {
        onChange({ kind: 'restore', key: removedKey });
      }}
      className="-mr-2.5"
    >
      Undo
    </Button>
  );
}
