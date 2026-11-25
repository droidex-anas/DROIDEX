import type {
  Automation,
  AutomationRun,
  AutomationProposal,
  AutomationSessionOrigin,
} from '@droidex/protocol';

export type AutomationDeliveryReceipt =
  | { status: 'accepted'; settled: Promise<void> }
  // `target` clears when that conversation frees up; `capacity` is global and
  // clears when any scheduled runtime slot is released.
  | { status: 'busy'; retryOn: 'target' | 'capacity' }
  // The caller's isCurrent turned false before any turn was dispatched.
  | { status: 'cancelled' }
  | { status: 'unavailable'; error: string };

export interface AutomationStore {
  version: 1;
  permissionSemanticsRevision: 1;
  automations: Automation[];
  runs: AutomationRun[];
  proposals: AutomationProposal[];
  /** Which run started a chat, for the chats an automation started. */
  sessionOrigins: Partial<Record<string, AutomationSessionOrigin>>;
}
