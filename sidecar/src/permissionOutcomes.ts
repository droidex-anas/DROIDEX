import type { PermissionOutcome } from './protocol.js';

const PERMISSION_OUTCOMES: Record<PermissionOutcome, true> = {
  proceed_once: true,
  proceed_always: true,
  proceed_auto_run: true,
  proceed_auto_run_low: true,
  proceed_auto_run_medium: true,
  proceed_auto_run_high: true,
  proceed_new_session: true,
  proceed_new_session_low: true,
  proceed_new_session_medium: true,
  proceed_new_session_high: true,
  proceed_edit: true,
  refuse: true,
  cancel: true,
};

export function normalizePermissionOutcome(outcome: string): PermissionOutcome {
  if (Object.hasOwn(PERMISSION_OUTCOMES, outcome)) return outcome as PermissionOutcome;
  throw new Error(`Unsupported permission outcome: ${outcome}`);
}

export function isApprovalOutcome(outcome: string): boolean {
  return normalizePermissionOutcome(outcome).startsWith('proceed');
}

// True only for a valid "always allow" outcome. Invalid/unknown outcomes return
// false so they can never persist an always-allow grant.
export function isAlwaysOutcome(outcome: string): boolean {
  try {
    return normalizePermissionOutcome(outcome) === 'proceed_always';
  } catch {
    return false;
  }
}
