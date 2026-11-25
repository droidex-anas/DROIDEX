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
 * The three flags say which cards this place owns: the composer keeps the plan
 * bar and shows a question in its own field, and whichever of the composer and
 * the voice surface is on screen shows the approvals.
 */
export default function InlineInteractions({
  appSessionId,
  plans = false,
  permissions = false,
  questions = false,
}: {
  appSessionId: string | null;
  plans?: boolean;
  permissions?: boolean;
  questions?: boolean;
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
      {permissions && <PermissionInline appSessionId={appSessionId} />}
      {questions && <AskUserInline appSessionId={appSessionId} />}
    </Suspense>
  );
}
