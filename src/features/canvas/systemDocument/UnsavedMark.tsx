// How an unsaved change looks against the draft's base (spec §6): a small
// accent dot before the name with what it was in a tooltip, and Undo on what
// was removed. The dot's slot is always kept, so names never shift.

import { Undo } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DraftChange } from './documentDraft';
import type { DraftMark } from './documentSections';

export function UnsavedMark({ mark, was }: { mark: DraftMark | undefined; was?: string }) {
  if (mark !== 'added' && mark !== 'changed')
    return <span aria-hidden="true" className="size-1.5 shrink-0" />;
  const label = mark === 'added' ? 'Added, not saved' : (was ?? 'Changed, not saved');
  return (
    <Tooltip label={label} className="shrink-0">
      <span role="img" aria-label={label} className="size-1.5 rounded-full bg-accent" />
    </Tooltip>
  );
}

/** Puts a removed item back. The document moves focus here when the item is removed. */
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
    >
      Undo
    </Button>
  );
}
