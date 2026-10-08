import type { PermissionMode, Query } from '@anthropic-ai/claude-agent-sdk';

import type { Autonomy } from '../../protocol.js';
import { claudePermissionMode } from './claudePermissions.js';

const AUTONOMY_LEVELS: readonly Autonomy[] = ['off', 'low', 'medium', 'high'];
const PERMISSION_MODES: readonly PermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'auto',
  'bypassPermissions',
];

// Autonomy and Spec share one CLI setting. This owner probes Auto before any
// prompt and serializes subsequent changes without losing the selected mode.
export class ClaudePermissionModes {
  private autoSupported = false;
  private changes: Promise<void> = Promise.resolve();
  private noticePending = false;
  private noticeReported = false;
  private requestedAutonomy: Autonomy;
  private nativeMode: PermissionMode;

  constructor(
    private autonomy: Autonomy,
    public planning: boolean,
    private readonly requireOpen: () => void,
    private readonly interrupt: () => Promise<void>,
  ) {
    this.requestedAutonomy = autonomy;
    this.nativeMode = this.mode(autonomy, planning);
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
    this.nativeMode = this.mode(this.autonomy, this.planning);
    this.noteFallback();
  }

  change(
    query: Pick<Query, 'setPermissionMode'>,
    initialized: Promise<void>,
    next: { autonomy?: Autonomy; planning?: boolean },
  ): Promise<void> {
    // Revoking permission cannot wait for the CLI or be undone by its refusal.
    if (next.autonomy !== undefined) {
      this.requestedAutonomy = next.autonomy;
      if (AUTONOMY_LEVELS.indexOf(next.autonomy) < AUTONOMY_LEVELS.indexOf(this.autonomy))
        this.autonomy = next.autonomy;
    }
    const applied = this.changes.then(async () => {
      await initialized;
      this.requireOpen();
      let autonomy = next.autonomy ?? this.autonomy;
      const planning = next.planning ?? this.planning;
      const isEscalation =
        AUTONOMY_LEVELS.indexOf(autonomy) > AUTONOMY_LEVELS.indexOf(this.autonomy);
      // A grant in Spec still needs the CLI's acknowledgement of plan mode.
      if (!planning || !this.planning || isEscalation)
        autonomy = await this.applyMode(query, autonomy, planning);
      this.requireOpen();
      // An older acknowledgement cannot restore access revoked behind it.
      this.autonomy =
        AUTONOMY_LEVELS.indexOf(autonomy) < AUTONOMY_LEVELS.indexOf(this.requestedAutonomy)
          ? autonomy
          : this.requestedAutonomy;
      this.planning = planning;
      this.noteFallback();
    });
    this.changes = applied.catch(() => undefined);
    return applied;
  }

  async startTurn(query: Pick<Query, 'setPermissionMode'>, start: () => void): Promise<void> {
    await this.changes;
    // A refused revocation leaves native bypassPermissions able to skip callbacks.
    while (this.needsNativeDowngrade()) {
      const applied = this.changes.then(() => this.applyMode(query, this.autonomy, this.planning));
      this.changes = applied.then(
        () => undefined,
        () => undefined,
      );
      await applied;
    }
    this.requireOpen();
    // No await may separate the final policy check from enqueueing the prompt.
    start();
  }

  private needsNativeDowngrade(): boolean {
    return (
      PERMISSION_MODES.indexOf(this.nativeMode) >
      PERMISSION_MODES.indexOf(this.mode(this.autonomy, this.planning))
    );
  }

  private async applyMode(
    query: Pick<Query, 'setPermissionMode'>,
    autonomy: Autonomy,
    planning: boolean,
  ): Promise<Autonomy> {
    try {
      let appliedAutonomy: Autonomy;
      do {
        const mode = this.mode(autonomy, planning);
        await query.setPermissionMode(mode);
        this.requireOpen();
        this.nativeMode = mode;
        appliedAutonomy = autonomy;
        autonomy = this.requestedAutonomy;
      } while (
        PERMISSION_MODES.indexOf(this.nativeMode) >
        PERMISSION_MODES.indexOf(this.mode(this.requestedAutonomy, planning))
      );
      return appliedAutonomy;
    } catch (error) {
      if (this.needsNativeDowngrade()) await this.interrupt();
      throw error;
    }
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
