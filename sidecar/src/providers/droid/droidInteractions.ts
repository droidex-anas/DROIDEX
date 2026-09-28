import {
  ToolConfirmationOutcome,
  type AskUserHandler,
  type AskUserRequestParams,
  type PermissionHandler,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk';

import { automationPermissionTarget } from '../../automations/permissionPolicy.js';
import { classifyPermission, confirmationType, permissionSignature } from '../../normalize.js';
import type { Autonomy, PermissionOutcome, SessionQuestion } from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';

const DROID_OUTCOMES: Record<PermissionOutcome, ToolConfirmationOutcome> = {
  proceed_once: ToolConfirmationOutcome.ProceedOnce,
  proceed_always: ToolConfirmationOutcome.ProceedAlways,
  proceed_auto_run: ToolConfirmationOutcome.ProceedAutoRun,
  proceed_auto_run_low: ToolConfirmationOutcome.ProceedAutoRunLow,
  proceed_auto_run_medium: ToolConfirmationOutcome.ProceedAutoRunMedium,
  proceed_auto_run_high: ToolConfirmationOutcome.ProceedAutoRunHigh,
  proceed_new_session: ToolConfirmationOutcome.ProceedNewSession,
  proceed_new_session_low: ToolConfirmationOutcome.ProceedNewSessionLow,
  proceed_new_session_medium: ToolConfirmationOutcome.ProceedNewSessionMedium,
  proceed_new_session_high: ToolConfirmationOutcome.ProceedNewSessionHigh,
  proceed_edit: ToolConfirmationOutcome.ProceedEdit,
  cancel: ToolConfirmationOutcome.Cancel,
};

// The Droid daemon asks through its own handler callbacks while DROIDEX decides
// in its own vocabulary, so this is the only place the two shapes meet.
export function droidInteractionHandlers(
  ref: { id: string; autonomy?: Autonomy },
  interactions: ProviderInteractions,
): { permissionHandler: PermissionHandler; askUserHandler: AskUserHandler } {
  return {
    permissionHandler: async (params) => {
      // A single callback may cover several tools; every one must be an edit.
      if (
        ref.autonomy === 'low' &&
        params.toolUses.length > 0 &&
        params.toolUses.every(({ details }) =>
          ['edit', 'create', 'apply_patch'].includes(details.type),
        )
      )
        return ToolConfirmationOutcome.ProceedOnce;
      return DROID_OUTCOMES[await requestApproval(ref.id, params, interactions)];
    },
    askUserHandler: async (params) => await interactions.requestQuestion(askedQuestions(params)),
  };
}

async function requestApproval(
  appSessionId: string,
  params: RequestPermissionRequestParams,
  interactions: ProviderInteractions,
): Promise<PermissionOutcome> {
  const signature = permissionSignature(params);
  const automationTool = automationPermissionTarget(params);
  return await interactions.requestApproval({
    request: classifyPermission(appSessionId, nextInteractionRequestId(), params),
    confirmationType: confirmationType(params),
    ...(signature ? { signature } : {}),
    ...(automationTool ? { automationTool } : {}),
  });
}

// The daemon omits `questions` entirely for an empty questionnaire and omits
// `options` for free-text answers, neither of which the declared type reflects.
function askedQuestions(params: AskUserRequestParams): SessionQuestion['questions'] {
  const asked: { questions?: { index: number; question: string; options?: string[] }[] } = params;
  return (asked.questions ?? []).map((question) => ({
    index: question.index,
    question: question.question,
    options: question.options ?? [],
  }));
}
