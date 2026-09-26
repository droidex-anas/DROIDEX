import { normalizePermissionOutcome } from './permissionOutcomes.js';

export function assertValidInteractionResponse(value: unknown): void {
  if (typeof value !== 'object' || value === null || !('type' in value)) return;
  if (value.type !== 'approval.respond' && value.type !== 'question.respond') return;
  if (
    !('appSessionId' in value) ||
    typeof value.appSessionId !== 'string' ||
    !value.appSessionId ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !value.requestId
  ) {
    throw new Error('Interaction responses require appSessionId and requestId.');
  }
  if (value.type === 'approval.respond') {
    if (!('outcome' in value) || typeof value.outcome !== 'string')
      throw new Error('Approval response requires an outcome.');
    normalizePermissionOutcome(value.outcome);
    return;
  }
  if (
    !('cancelled' in value) ||
    typeof value.cancelled !== 'boolean' ||
    !('answers' in value) ||
    !Array.isArray(value.answers) ||
    !value.answers.every(isQuestionAnswer)
  ) {
    throw new Error('Question response requires cancelled and structured answers.');
  }
}

function isQuestionAnswer(answer: unknown): boolean {
  if (typeof answer !== 'object' || answer === null) return false;
  return (
    'index' in answer &&
    typeof answer.index === 'number' &&
    Number.isSafeInteger(answer.index) &&
    answer.index >= 0 &&
    'question' in answer &&
    typeof answer.question === 'string' &&
    'selected' in answer &&
    Array.isArray(answer.selected) &&
    answer.selected.every((selection: unknown) => typeof selection === 'string') &&
    (!('custom' in answer) || typeof answer.custom === 'string')
  );
}
