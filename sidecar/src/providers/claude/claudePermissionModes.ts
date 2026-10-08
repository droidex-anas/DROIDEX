import type { PermissionMode, Query } from '@anthropic-ai/claude-agent-sdk';

import type { Autonomy } from '../../protocol.js';
import { claudePermissionMode } from './claudePermissions.js';

// Autonomy and Spec share one CLI setting. This owner probes Auto before any
// prompt and serializes subsequent changes without losing the selected mode.
export class ClaudePermissionModes {
  private autoSupported = false;
  private changes: Promise<void> = Promise.resolve();
  private noticePending = false;
  private noticeReported = false;
  private requestedAutonomy: Autonomy;

  constructor(
    private autonomy: Autonomy,
    public planning: boolean,
    private readonly requireOpen: () => void,
  ) {
    this.requestedAutonomy = autonomy;
  }

  async initialize(query: Pick<Query, 'setPermissionMode'>): Promise<void> {
    try {
      await query.setPermissionMode('auto');
      this.requireOpen();
      this.autoSupported = true;
    } catch {
      // A rejected capability probe is recoverable only while the CLI is live.
      this.requireOpen();
    }
    await query.setPermissionMode(this.mode(this.autonomy, this.planning));
    this.requireOpen();
    this.noteFallback();
  }

  change(
    query: Pick<Query, 'setPermissionMode'>,
    initialized: Promise<void>,
    next: { autonomy?: Autonomy; planning?: boolean },
  ): Promise<void> {
    const levels: readonly Autonomy[] = ['off', 'low', 'medium', 'high'];
    // Revoking permission cannot wait for the CLI or be undone by its refusal.
    if (next.autonomy !== undefined) {
      this.requestedAutonomy = next.autonomy;
      if (levels.indexOf(next.autonomy) < levels.indexOf(this.autonomy))
        this.autonomy = next.autonomy;
    }
    const applied = this.changes.then(async () => {
      await initialized;
      this.requireOpen();
      const autonomy = next.autonomy ?? this.autonomy;
      const planning = next.planning ?? this.planning;
      const isEscalation = levels.indexOf(autonomy) > levels.indexOf(this.autonomy);
      // A grant in Spec still needs the CLI's acknowledgement of plan mode.
      if (!planning || !this.planning || isEscalation)
        await query.setPermissionMode(this.mode(autonomy, planning));
      this.requireOpen();
      // An older acknowledgement cannot restore access revoked behind it.
      this.autonomy =
        levels.indexOf(autonomy) < levels.indexOf(this.requestedAutonomy)
          ? autonomy
          : this.requestedAutonomy;
      this.planning = planning;
      this.noteFallback();
    });
    this.changes = applied.catch(() => undefined);
    return applied;
  }

  selection(): Autonomy {
    return this.autonomy;
  }

  takeNotice(): string | undefined {
    if (!this.noticePending) return undefined;
    this.noticePending = false;
    this.noticeReported = true;
    return 'Auto permissions are unavailable in this Claude Code session; approvals still ask.';
  }

  private mode(autonomy: Autonomy, planning: boolean): PermissionMode {
    if (planning) return 'plan';
    if (autonomy === 'medium' && !this.autoSupported) return 'default';
    return claudePermissionMode(autonomy);
  }

  private noteFallback(): void {
    this.noticePending =
      this.autonomy === 'medium' && !this.planning && !this.autoSupported && !this.noticeReported;
  }
}
