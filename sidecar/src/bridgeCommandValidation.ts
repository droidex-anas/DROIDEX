import { assertValidInteractionResponse } from './interactionResponses.js';
import { assertValidResponseFormat } from './appPrompt.js';
import { assertValidMentions } from './providers/catalog.js';
import { providerKind } from './providers/providerKind.js';

export function assertValidBridgeCommand(command: unknown): void {
  if (typeof command !== 'object' || command === null) throw new Error('Invalid bridge command.');
  if ('responseFormat' in command) assertValidResponseFormat(command.responseFormat);
  if ('mentions' in command) assertValidMentions(command);
  assertValidSteerId(command);
  assertValidInteractionResponse(command);
  assertValidChatPreferences(command);
  assertValidUsageRefresh(command);
  assertValidChildHistoryWatch(command);
}

// Optional on a send; queue actions name the steer they are for.
function assertValidSteerId(command: object): void {
  const withdrawing = 'type' in command && command.type === 'session.withdrawSteer';
  const required = withdrawing || ('type' in command && command.type === 'session.sendNow');
  if (!required && !('steerId' in command)) return;
  const steerId = 'steerId' in command ? command.steerId : undefined;
  if (typeof steerId !== 'string' || !steerId) throw new Error('Invalid steer id.');
  if (withdrawing) {
    if (
      !('appSessionId' in command) ||
      typeof command.appSessionId !== 'string' ||
      !command.appSessionId
    )
      throw new Error('Invalid app session id.');
    if (!('requestId' in command) || typeof command.requestId !== 'string' || !command.requestId)
      throw new Error('Invalid withdrawal request id.');
  }
}

function assertValidChatPreferences(command: object): void {
  const settingsCommand =
    'type' in command &&
    (command.type === 'session.create' || command.type === 'session.updateSettings');
  if ('droidProfile' in command) {
    if (!('type' in command) || command.type !== 'session.create' || command.droidProfile !== 'alt')
      throw new Error('A Droid profile can only be selected when creating a session.');
  }
  if ('fastMode' in command) {
    if (typeof command.fastMode !== 'boolean') throw new Error('fastMode must be a boolean.');
    if (!settingsCommand) throw new Error('Fast mode only applies to top-level session settings.');
  }
  if ('contextWindowTokens' in command) {
    if (command.contextWindowTokens !== 200000 && command.contextWindowTokens !== 1000000)
      throw new Error('contextWindowTokens must be 200000 or 1000000.');
    if (!settingsCommand)
      throw new Error('A context window only applies to top-level session settings.');
  }
}

// Account reads can start a harness process, so their switches are validated here.
function assertValidUsageRefresh(command: object): void {
  if (!('type' in command) || command.type !== 'usage.refresh') return;
  const { provider, panelOpen, immediate } = command as Record<string, unknown>;
  if (!providerKind(provider)) throw new Error('usage.refresh needs a known harness.');
  if (typeof panelOpen !== 'boolean' || typeof immediate !== 'boolean')
    throw new Error('usage.refresh needs panelOpen and immediate as booleans.');
}

function assertValidChildHistoryWatch(command: object): void {
  if (!('type' in command) || command.type !== 'child.watchHistory') return;
  const requestId = 'requestId' in command ? command.requestId : undefined;
  if (typeof requestId !== 'string' || !requestId || requestId.length > 128)
    throw new Error('child.watchHistory needs a request ID.');
  const target = 'target' in command ? command.target : undefined;
  assertValidChildHistoryTarget(target);
}

function assertValidChildHistoryTarget(target: unknown): void {
  if (target === null) return;
  if (typeof target !== 'object')
    throw new Error('child.watchHistory needs a child target or null.');
  const parentId = 'parentAppSessionId' in target ? target.parentAppSessionId : undefined;
  const childId = 'childSessionId' in target ? target.childSessionId : undefined;
  for (const id of [parentId, childId]) {
    if (typeof id !== 'string' || !id || id.length > 256)
      throw new Error('child.watchHistory needs stable parent and child IDs.');
  }
  const limit = 'limit' in target ? target.limit : undefined;
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1600)
  )
    throw new Error('child.watchHistory limit must be between 1 and 1600.');
}
