import { isAbsolute } from 'node:path';

import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy } from '../../protocol.js';
import type { ProviderMention } from '../catalog.js';
import type { ProviderModelSettings } from '../session.js';
import { codexAutonomy, codexSandboxPolicy } from './codexApprovals.js';

export interface TurnSettings {
  autonomy: Autonomy;
  model: ProviderModelSettings;
  // The model the thread resolved to, which is what a cleared model goes back
  // to: a turn's overrides stick to the thread, so omitting the field would
  // leave the last override in place instead.
  threadModel?: string;
}

// What a turn is asked for: the prompt plus the settings the session holds.
export function turnStartParams(
  threadId: string,
  prompt: string,
  mentions: ProviderMention[] | undefined,
  settings: TurnSettings,
) {
  const { approvalPolicy, sandbox } = codexAutonomy(settings.autonomy);
  const model = settings.model.modelId ?? settings.threadModel;
  return {
    threadId,
    input: turnInput(prompt, mentions),
    approvalPolicy,
    sandboxPolicy: codexSandboxPolicy(sandbox),
    ...(model ? { model } : {}),
    ...(settings.model.reasoningEffort ? { effort: settings.model.reasoningEffort } : {}),
    // Codex reports no reasoning at all until a turn asks for a summary: the
    // reasoning item arrives empty and no delta ever follows. Without this the
    // whole thinking phase is blank in the transcript, whatever the effort.
    summary: 'auto',
  };
}

export function turnInput(prompt: string, mentions: ProviderMention[] = []) {
  return [
    { type: 'text' as const, text: prompt },
    ...mentions.map((mention) => {
      const path = mention.path;
      if (!path) throw new Error(`${mention.kind} mention ${mention.name} has no invocation path.`);
      if (mention.kind === 'skill') {
        if (!isAbsolute(path))
          throw new Error(`Skill mention ${mention.name} does not have an absolute skill path.`);
        return { type: 'skill' as const, name: mention.name, path };
      }
      const prefix = `${mention.kind}://`;
      if (!path.startsWith(prefix) || path.length === prefix.length)
        throw new Error(`${mention.kind} mention ${mention.name} has an invalid invocation path.`);
      return { type: 'mention' as const, name: mention.name, path };
    }),
  ];
}

// One turn's events, filled by the notification handlers and drained by the
// turn that is streaming. Events that arrive outside a turn have no transcript
// to land in and are dropped.
export class TurnStream {
  private readonly queued: NormalizedEvent[] = [];
  private waiting?: () => void;
  private settlement?: Error | 'done';

  push(events: NormalizedEvent[]): void {
    this.queued.push(...events);
    this.wake();
  }

  // The turn is over: it completed, or the session released it because the
  // consumer stopped reading. Either way a waiter inside drain() must wake.
  finish(): void {
    this.settlement ??= 'done';
    this.wake();
  }

  // First settlement wins: whichever of the failing error notification, the
  // failed turn or the dead process arrives first is the turn's cause.
  fail(error: Error): void {
    this.settlement ??= error;
    this.wake();
  }

  async *drain(): AsyncGenerator<NormalizedEvent, void, undefined> {
    for (;;) {
      const next = this.queued.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.settlement === 'done') return;
      if (this.settlement) throw this.settlement;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.();
  }
}
