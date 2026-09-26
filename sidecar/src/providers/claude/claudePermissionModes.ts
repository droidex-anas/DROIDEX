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

  constructor(
    private autonomy: Autonomy,
    public planning: boolean,
    private readonly requireOpen: () => void,
  ) {}

  async initialize(query: Pick<Query, 'setPermissionMode'>): Promise<void> {
    try {
      await query.setPermissionMode('auto');
      this.requireOpen();
      this.autoSupported = true;
    } catch {
      // A rejected capability probe is recoverable only while the CLI is live.
      this.requireOpen();
    }
    this.requireOpen();
    await query.setPermissionMode(this.mode(this.autonomy, this.planning));
    this.requireOpen();
    this.noteFallback();
  }

  change(
    query: Pick<Query, 'setPermissionMode'>,
    initialized: Promise<void>,
    next: () => { autonomy: Autonomy; planning: boolean },
  ): Promise<void> {
    const applied = this.changes.then(async () => {
      await initialized;
      this.requireOpen();
      const { autonomy, planning } = next();
      if (!planning || !this.planning) await query.setPermissionMode(this.mode(autonomy, planning));
      this.requireOpen();
      this.autonomy = autonomy;
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
