import type { Autonomy, ReasoningEffort } from '../protocol.js';
import type { ProviderKind } from '../providers/providerKind.js';

export interface ThreadInput {
  title: string;
  prompt: string;
  provider: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy: Autonomy;
  cwd?: string;
}

export interface ProjectThread {
  appSessionId: string;
  // Another top-level session, never a Mission Control child identity.
  ownerAppSessionId?: string;
  title: string;
  reply: string;
  waiting: boolean;
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  kind: 'result' | 'question' | 'message';
  text: string;
}

export interface Project {
  id: string;
  title: string;
  paused: boolean;
  wakesLeft: number;
  launching: number;
  threads: ProjectThread[];
  pending: ThreadMessage[];
  delivery?: { state: 'sending' | 'uncertain'; messages: ThreadMessage[] };
  error?: string;
}

export interface ProjectView {
  id: string;
  title: string;
  paused: boolean;
  wakesLeft: number;
  launching: number;
  threads: Omit<ProjectThread, 'reply'>[];
  queued: number;
  uncertain: number;
  error?: string;
}

export type ProjectCommand =
  | { type: 'projects.list' }
  | { type: 'project.create'; requestId: string; input: ThreadInput }
  | {
      type: 'project.pause';
      requestId: string;
      projectId: string;
      paused: boolean;
      acknowledgeDelivery?: boolean;
    };

export type ProjectEvent =
  | { type: 'projects.snapshot'; projects: ProjectView[] }
  | { type: 'project.result'; requestId: string; projectId?: string; error?: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isProjectView(value: unknown): value is ProjectView {
  if (!record(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.paused === 'boolean' &&
    Number.isInteger(value.wakesLeft) &&
    Number.isInteger(value.launching) &&
    Number.isInteger(value.queued) &&
    Number.isInteger(value.uncertain) &&
    (value.error === undefined || typeof value.error === 'string') &&
    Array.isArray(value.threads) &&
    value.threads.length <= 8 &&
    value.threads.every(
      (thread) =>
        record(thread) &&
        typeof thread.appSessionId === 'string' &&
        typeof thread.title === 'string' &&
        typeof thread.waiting === 'boolean' &&
        (thread.ownerAppSessionId === undefined || typeof thread.ownerAppSessionId === 'string'),
    )
  );
}
