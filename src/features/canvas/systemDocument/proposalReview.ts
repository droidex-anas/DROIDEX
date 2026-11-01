// Whether the user is reviewing a kit's agent proposal (spec §11), how its
// marks read, and the decision that ends the review. Like a draft, a review is per kit for the app
// session: it outlasts leaving the document, and a chat's proposal chip starts
// one. Accept, Discard and Close review end it.

import { createContext, useRef, useState, useSyncExternalStore } from 'react';
import { pushToast } from '../../../lib/toast';
import { canvasClient } from '../canvasClient';
import { canvasMessage, CanvasRequestError } from '../client';
import type { DesignSystemDocumentView } from '../protocol';

/**
 * Null for the user's draft. In a review, whether an addition is labelled: an
 * item in a section the agent added leaves the label to its section.
 */
export const ProposalMarks = createContext<{ labelsAdded: boolean } | null>(null);
export const IN_REVIEW = { labelsAdded: true };
export const IN_ADDED_SECTION = { labelsAdded: false };

const reviewing = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  for (const listener of listeners) listener();
}

export function startReview(id: string): void {
  if (reviewing.has(id)) return;
  reviewing.add(id);
  publish();
}

export function endReview(id: string): void {
  if (reviewing.delete(id)) publish();
}

export function useIsReviewing(id: string): boolean {
  return useSyncExternalStore(subscribe, () => reviewing.has(id));
}

export type ProposalDecision = 'idle' | 'accepting' | 'discarding';

/**
 * Accepts the shown latest version's proposal as the next version, or discards
 * it. The review ends only once the document shows the outcome, so the version
 * before it never flashes in between.
 */
export function useProposalDecision(
  view: DesignSystemDocumentView,
  onShow: (target: 'latest') => Promise<void>,
) {
  const [decision, setDecision] = useState<ProposalDecision>('idle');
  const decidingRef = useRef(false);
  // A retry after a lost answer reuses the mutation ID, so it finds the version
  // already saved instead of refusing for want of a proposal.
  const attemptRef = useRef<{ proposalId: string; onto: number; mutationId: string } | null>(null);

  const decide = async (next: Exclude<ProposalDecision, 'idle'>, send: () => Promise<unknown>) => {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDecision(next);
    try {
      await send();
      attemptRef.current = null;
      await onShow('latest');
      endReview(view.id);
    } catch (error) {
      if (error instanceof CanvasRequestError) attemptRef.current = null;
      // A version saved meanwhile reaches the document by its change event,
      // which turns Accept into Accept over it.
      if (!(error instanceof CanvasRequestError && error.code === 'revision_conflict'))
        pushToast(canvasMessage(error), 'error');
    } finally {
      decidingRef.current = false;
      setDecision('idle');
    }
  };

  const accept = () => {
    const { proposal } = view;
    if (!proposal) return;
    const onto = view.latestVersion;
    const attempt = attemptRef.current;
    const { proposalId } = proposal;
    const mutationId =
      attempt?.proposalId === proposalId && attempt.onto === onto
        ? attempt.mutationId
        : crypto.randomUUID();
    attemptRef.current = { proposalId, onto, mutationId };
    void decide('accepting', () =>
      canvasClient.designSystems.acceptProposal(mutationId, view.id, proposalId, onto),
    );
  };

  const discard = () => {
    const { proposal } = view;
    if (!proposal) return;
    void decide('discarding', () =>
      canvasClient.designSystems.discardProposal(view.id, proposal.proposalId),
    );
  };

  return { decision, accept, discard };
}
