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
  appSessionId,
  plans = false,
  asks = false,
}: {
  appSessionId: string | null;
  plans?: boolean;
  asks?: boolean;
}) {
  const pending = useStoreSelector((current) => {
    if (!appSessionId) return false;
    return (
      Boolean(current.pendingPermissions[appSessionId]?.length) ||
      Boolean(current.pendingQuestions[appSessionId]?.length)
    );
  });
  const [askedSessionId, setAskedSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (pending) setAskedSessionId(appSessionId);
  }, [pending, appSessionId]);

  if (!appSessionId || (!pending && askedSessionId !== appSessionId)) return null;
  return (
    <Suspense fallback={null}>
      {plans && <PlanApprovalInline appSessionId={appSessionId} />}
      {asks && (
        <>
          <PermissionInline appSessionId={appSessionId} />
          <AskUserInline appSessionId={appSessionId} />
        </>
      )}
    </Suspense>
  );
}
