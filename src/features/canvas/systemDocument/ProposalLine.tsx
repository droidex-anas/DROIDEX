// The line under the header while the agent's proposal waits (spec §11): the
// chat it came from and how much it changes, with Discard and Review, or Close
// review while it is shown. It opens and closes with the expand motion, and
// keeps its last words while it closes.

import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { useStoreSelector } from '../../../hooks/useStore';
import { chatDisplayTitle } from '../../../lib/chatMetadata';
import type { DesignSystemProposal } from '../protocol';
import { DocumentNotice } from './DocumentHeader';
import type { ProposalDecision } from './proposalReview';

interface ShownLine {
  appSessionId: string;
  count: number;
}

export function ProposalLine({
  proposal,
  count,
  isReviewing,
  decision,
  onReview,
  onCloseReview,
  onDiscard,
}: {
  /** Null once there is none to review, which closes the line. */
  proposal: DesignSystemProposal | null;
  /** Its changes against the version on screen. */
  count: number;
  isReviewing: boolean;
  decision: ProposalDecision;
  onReview: () => void;
  onCloseReview: () => void;
  onDiscard: () => void;
}) {
  const open = proposal !== null;
  const [shown, setShown] = useState<ShownLine | null>(
    proposal && { appSessionId: proposal.appSessionId, count },
  );
  if (proposal && (proposal.appSessionId !== shown?.appSessionId || count !== shown.count))
    setShown({ appSessionId: proposal.appSessionId, count });
  const chat = useStoreSelector((state) => {
    const id = shown?.appSessionId;
    if (id === undefined || !(id in state.sessions)) return null;
    return chatDisplayTitle(state.sessions[id], state.chatMetadata[id]);
  });
  const isDeciding = decision !== 'idle';

  return (
    <div className="expand-rows shrink-0" data-open={open || undefined}>
      <div
        inert={!open}
        className={cn(
          'min-h-0 overflow-hidden transition-opacity duration-quick ease-out motion-reduce:transition-none',
          !open && 'opacity-0',
        )}
      >
        {shown && (
          <DocumentNotice text={lineText(chat, shown.count)}>
            {isReviewing ? (
              <Button variant="ghost" size="sm" disabled={isDeciding} onClick={onCloseReview}>
                Close review
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={decision === 'discarding'}
                  disabled={isDeciding}
                  onClick={onDiscard}
                >
                  Discard
                </Button>
                <Button variant="secondary" size="sm" disabled={isDeciding} onClick={onReview}>
                  Review
                </Button>
              </>
            )}
          </DocumentNotice>
        )}
      </div>
    </div>
  );
}

function lineText(chat: string | null, count: number): string {
  const changes = `${String(count)} ${count === 1 ? 'change' : 'changes'}`;
  return chat === null
    ? `The agent proposed changes · ${changes}`
    : `The agent proposed changes in ${chat} · ${changes}`;
}
