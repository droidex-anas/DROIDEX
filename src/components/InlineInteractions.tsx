import { lazy, Suspense, useEffect, useState } from 'react';
import { useStoreSelector } from '../hooks/useStore';

const PlanApprovalInline = lazy(() => import('./PlanApprovalInline'));
const PermissionInline = lazy(() => import('./PermissionInline'));
const AskUserInline = lazy(() => import('./AskUserInline'));

/**
 * The cards a chat shows while it is blocked on the user: a plan to approve, an
 * approval to answer, a question to answer. They load on the chat's first
 * pending request rather than with the composer, and stay mounted afterwards so
 * a card that settles still plays its way out.
 *
 * `plans` and `asks` say which of the two places owns which cards: the composer
 * keeps the plan bar, and whichever of the composer and the voice surface is on
 * screen shows the approvals and questions.
 */
export default function InlineInteractions({
  plans = false,
  asks = false,
}: {
  plans?: boolean;
  asks?: boolean;
}) {
  const pending = useStoreSelector((current) => {
    const id = current.activeAppSessionId;
    if (!id) return false;
    return (
      Boolean(current.pendingPermissions[id]?.length) ||
      Boolean(current.pendingQuestions[id]?.length)
    );
  });
  const [asked, setAsked] = useState(pending);

  useEffect(() => {
    if (pending) setAsked(true);
  }, [pending]);

  if (!asked) return null;
  return (
    <Suspense fallback={null}>
      {plans && <PlanApprovalInline />}
      {asks && (
        <>
          <PermissionInline />
          <AskUserInline />
        </>
      )}
    </Suspense>
  );
}
