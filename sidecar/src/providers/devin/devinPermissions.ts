import { createHash } from 'node:crypto';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk/unstable';
import type { PermissionKind } from '@droidex/protocol';
import { objectValue, trimmedString } from '../../values.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';
import { devinToolName } from './devinEvents.js';

function permissionSignature(toolCall: RequestPermissionRequest['toolCall']): string | undefined {
  if (toolCall.kind === 'switch_mode' || toolCall.rawInput == null) return undefined;
  const action = JSON.stringify({
    kind: toolCall.kind,
    input: toolCall.rawInput,
    locations: toolCall.locations,
    content: toolCall.content,
  });
  return `devin::${devinToolName(toolCall)}::${createHash('sha256').update(action).digest('hex')}`;
}

export async function devinPermission(
  appSessionId: string,
  request: RequestPermissionRequest,
  interactions: ProviderInteractions,
  signal: AbortSignal,
): Promise<RequestPermissionResponse> {
  const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };
  const isCancelled = () => signal.aborted || !interactions.isActive();
  if (isCancelled()) return cancelled;
  const options = request.options.filter((option) => option.optionId.trim() !== 'plan_bypass');
  const signature = permissionSignature(request.toolCall);
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
  const plan =
    kind === 'spec'
      ? (trimmedString(objectValue(request.toolCall.rawInput)?.plan) ??
        trimmedString(
          (request.toolCall.content ?? [])
            .flatMap((item) =>
              item.type === 'content' && item.content.type === 'text' ? [item.content.text] : [],
            )
            .join('\n'),
        ))
      : undefined;
  const outcome = await interactions.requestApproval({
    request: {
      appSessionId,
      requestId: nextInteractionRequestId(),
      kind,
      title: devinToolName(request.toolCall),
      detail: plan ?? JSON.stringify(request.toolCall.rawInput ?? request.toolCall.title ?? ''),
      ...(plan ? { plan } : {}),
      canAlwaysAllow:
        Boolean(signature) && options.some((option) => option.kind === 'allow_always'),
      raw: request.toolCall,
    },
    confirmationType: kind === 'spec' ? 'exit_spec_mode' : kind,
    ...(signature ? { signature } : {}),
    signal,
    canApproveFor: (actor) =>
      actor.provider === 'devin' &&
      ((kind === 'edit' && actor.autonomy !== 'off') ||
        (kind === 'exec' && actor.autonomy === 'high')),
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
  return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : cancelled;
}
