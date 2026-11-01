// How a change looks against what it changes (spec §6, §11): a small accent
// dot before the name with what it was in a tooltip, and Undo on what was
// removed. The dot hangs outside the name's row, so names never shift and
// start on the column's edge. In a review of the agent's proposal the marks
// are the agent's, and what it added also says "Added" after its name.

import { useContext } from 'react';
import { Undo } from '@droidex/icons';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DraftChange } from './documentDraft';
import type { DraftMark } from './documentSections';
import { ProposalMarks } from './proposalReview';

const MARK_LABELS = {
  user: { added: 'Added, not saved', changed: 'Changed, not saved' },
  agent: { added: 'Added by the agent', changed: 'Changed by the agent' },
};

/** The dot, 8px left of the positioned row it is in, which starts where the name does. */
export function UnsavedMark({ mark, was }: { mark: DraftMark | undefined; was?: string }) {
  const proposal = useContext(ProposalMarks);
  if (mark !== 'added' && mark !== 'changed') return null;
  const label =
    mark === 'changed' && was !== undefined ? was : MARK_LABELS[proposal ? 'agent' : 'user'][mark];
  return (
    <Tooltip label={label} className="absolute right-full top-1/2 mr-2 -translate-y-1/2">
      <span role="img" aria-label={label} className="size-1.5 rounded-full bg-accent" />
    </Tooltip>
  );
}

/** After the name of what the agent's proposal adds. */
export function AddedLabel({ mark }: { mark: DraftMark | undefined }) {
  const proposal = useContext(ProposalMarks);
  if (mark !== 'added' || !proposal?.labelsAdded) return null;
  return <Badge tone="accent">Added</Badge>;
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
