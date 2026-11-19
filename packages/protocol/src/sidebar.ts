import type { SessionQuestion } from './transcript.js';

export const SIDEBAR_ROW_LIMITS = {
  rows: 5_000,
  title: 200,
  permissionDetail: 2_000,
  questions: 16,
  questionText: 2_000,
  options: 16,
  optionText: 500,
} as const;

export type SidebarMark = 'settled' | 'reopened' | 'archived';

// What the sidecar asks the window about the chats in its sidebar: only the
// window knows which chats it shows and how.
export interface SidebarRequest {
  requestId: string;
  // Epoch ms when the sidecar stops waiting. The window neither answers nor
  // acts in the last second before it, so it never applies a change the
  // sidecar has already reported as failed.
  expiresAt: number;
  query:
    | { kind: 'rows'; appSessionIds?: string[] }
    | {
        kind: 'mark';
        mark: SidebarMark;
        // updatedAt is the chat's activity time as the sidecar saw it.
        targets: { appSessionId: string; updatedAt: number }[];
      };
}

export type SidebarResult =
  | { requestId: string; kind: 'rows'; rows: SidebarRow[] }
  | { requestId: string; kind: 'mark'; outcomes: SidebarMarkOutcome[] };

export interface SidebarMarkOutcome {
  appSessionId: string;
  done: boolean;
  reason?: string;
}

// A chat as the sidebar shows it, with text cut to the sidebar's row limits.
export interface SidebarRow {
  appSessionId: string;
  title: string;
  status: SessionActivityStatus;
  // The words the sidebar shows for the status.
  label: string;
  unread: boolean;
  onScreen?: true;
  pinned?: true;
  settledAt?: number;
  // Every pull request linked to the chat is merged or closed.
  prDone?: true;
  permission?: { title: string; detail: string };
  question?: { requestId: string; questions: SessionQuestion['questions'] };
}

export type SessionActivityStatus =
  | 'working'
  | 'approval'
  | 'input'
  | 'plan'
  | 'failed'
  | 'interrupted'
  | 'reply'
  | 'review'
  | 'ship'
  | 'ready'
  | 'settled';
