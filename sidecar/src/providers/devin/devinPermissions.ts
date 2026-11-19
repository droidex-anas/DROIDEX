import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { Autonomy, PermissionKind, PermissionOutcome } from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';
import { devinToolName, isDevinChild } from './devinEvents.js';

const IMPLEMENTATION_AUTONOMY: Partial<Record<PermissionOutcome, Autonomy>> = {
  proceed_auto_run: 'high',
  proceed_auto_run_low: 'low',
  proceed_auto_run_medium: 'medium',
  proceed_auto_run_high: 'high',
  proceed_new_session: 'high',
  proceed_new_session_low: 'low',
  proceed_new_session_medium: 'medium',
  proceed_new_session_high: 'high',
};

export async function devinPermission(
  appSessionId: string,
  request: RequestPermissionRequest,
  interactions: ProviderInteractions,
  signal: AbortSignal,
  approvePlan: (autonomy: Autonomy | undefined) => Promise<void>,
): Promise<RequestPermissionResponse> {
  const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };
  const isCancelled = () => signal.aborted || !interactions.isActive();
  if (isCancelled() || isDevinChild(request.toolCall)) return cancelled;
  const options = request.options.filter((option) => option.optionId.trim() !== 'plan_bypass');
  let kind: PermissionKind = 'other';
  switch (request.toolCall.kind) {
    case 'edit':
      kind = 'edit';
      break;
    case 'execute':
      kind = 'exec';
      break;
    case 'switch_mode':
      kind = 'spec';
      break;
  }
  const outcome = await interactions.requestApproval({
    request: {
      appSessionId,
      requestId: nextInteractionRequestId(),
      kind,
      title: devinToolName(request.toolCall),
      detail: JSON.stringify(request.toolCall.rawInput ?? request.toolCall.title ?? ''),
      canAlwaysAllow: options.some((option) => option.kind === 'allow_always'),
      raw: request.toolCall,
    },
    confirmationType: kind === 'spec' ? 'exit_spec_mode' : kind,
    signal,
  });
  if (isCancelled() || outcome === 'cancel') return cancelled;
  let preferred = 'reject_once';
  if (outcome === 'proceed_always') preferred = 'allow_always';
  else if (outcome.startsWith('proceed')) preferred = 'allow_once';
  const option =
    options.find((value) => value.kind === preferred) ??
    (preferred === 'allow_always'
      ? options.find((value) => value.kind === 'allow_once')
      : undefined);
  if (!option) return cancelled;
  if (kind === 'spec' && option.kind.startsWith('allow')) {
    await approvePlan(IMPLEMENTATION_AUTONOMY[outcome]);
    if (isCancelled()) return cancelled;
  }
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}
