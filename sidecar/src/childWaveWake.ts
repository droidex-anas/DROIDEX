import type { ChildActivity, ChildRole, ChildStatus } from './protocol.js';

/* Waking a chat whose agents have finished. A harness reports a background
   agent's ending to the host, but sends an idle parent nothing: the parent
   sleeps on with results nobody carried to it (verified against the agent SDK
   on 2026-09-22; its own CLI injects the notification itself). The host is the
   only party that knows the wave stopped, so it spends one turn saying so. */

export interface SettledAgent {
  name: string;
  status: 'completed' | 'failed';
  // The last step the agent reported. An autonomous agent streams no transcript
  // to its parent, so this is the most the app ever knows about what it did.
  step?: string;
}

// The transcript row the wake leaves behind. Nobody typed the prompt, so the
// chat shows this instead of a prompt bubble.
export const AGENT_WAKE_NOTICE = 'Agents finished; continuing';

export function isSettledChildStatus(status: ChildStatus): status is 'completed' | 'failed' {
  return status === 'completed' || status === 'failed';
}

export function settledAgent(
  child: { label?: string; role: ChildRole; status: ChildStatus; activity?: ChildActivity },
  index: number,
): SettledAgent {
  const role = child.role === 'validator' ? 'Validator' : 'Worker';
  return {
    name: child.label ?? `${role} ${String(index + 1)}`,
    status: child.status === 'failed' ? 'failed' : 'completed',
    ...(child.activity?.preview ? { step: child.activity.preview } : {}),
  };
}

// One block per agent, claiming only what the app was told: the agent's name,
// how it ended, and the last step it reported.
export function agentWakePrompt(agents: readonly SettledAgent[]): string {
  const blocks = agents.map((agent) =>
    agent.step
      ? `- ${agent.name}: ${agent.status}. Last reported step: ${agent.step}`
      : `- ${agent.name}: ${agent.status}`,
  );
  return [
    'The agents you started have finished while this chat was idle.',
    ...blocks,
    'Continue from these results.',
  ].join('\n');
}
