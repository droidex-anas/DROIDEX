// How a change looks against what it changes (spec §6, §11): a small accent
// dot before the name with what it was in a tooltip, and Undo on what was
// removed. The dot's slot is always kept, so names never shift. In a review of
// the agent's proposal the marks are the agent's, and what it added also says
// "Added" after its name.

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

export function UnsavedMark({ mark, was }: { mark: DraftMark | undefined; was?: string }) {
  const proposal = useContext(ProposalMarks);
  if (mark !== 'added' && mark !== 'changed')
    return <span aria-hidden="true" className="size-1.5 shrink-0" />;
  const label =
    mark === 'changed' && was !== undefined ? was : MARK_LABELS[proposal ? 'agent' : 'user'][mark];
  return (
    <Tooltip label={label} className="shrink-0">
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
