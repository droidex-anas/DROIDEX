import type { PermissionMode, Query } from '@anthropic-ai/claude-agent-sdk';

import type { Autonomy } from '../../protocol.js';
import { SessionAutonomy } from '../sessionAutonomy.js';
import { claudePermissionMode } from './claudePermissions.js';

const PERMISSION_MODES: readonly PermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'auto',
  'bypassPermissions',
];

// Spec and autonomy share the CLI's permission mode, so they have one writer.
export class ClaudePermissionModes {
  private autoSupported = false;
  private noticePending = false;
  private noticeReported = false;
  private readonly autonomy: SessionAutonomy;
  private nativeMode: PermissionMode;
  private latestPlanning: boolean;
  private query?: Pick<Query, 'setPermissionMode'>;

  constructor(
    autonomy: Autonomy,
    public planning: boolean,
    private readonly requireOpen: () => void,
    interrupt: () => Promise<void>,
    close: () => Promise<void>,
  ) {
    this.latestPlanning = planning;
    this.nativeMode = this.mode(autonomy, planning);
    this.autonomy = new SessionAutonomy(autonomy, {
      write: async () => {
        if (!this.query) throw new Error('Claude permission modes are not initialized.');
        const level = this.autonomy.latestAutonomy;
        const planning = this.latestPlanning;
        const mode = this.mode(level, planning);
        if (mode !== this.nativeMode || level !== this.autonomy.selection)
          await this.query.setPermissionMode(mode);
        this.requireOpen();
        this.nativeMode = mode;
        this.planning = planning;
        this.noteFallback();
        return level;
      },
      isApplied: () =>
        this.nativeMode === this.mode(this.autonomy.latestAutonomy, this.latestPlanning),
      isUnsafe: () =>
        PERMISSION_MODES.indexOf(this.nativeMode) >
        PERMISSION_MODES.indexOf(this.mode(this.autonomy.latestAutonomy, this.latestPlanning)),
      interrupt,
      close,
      requireOpen,
    });
  }

  async initialize(query: Pick<Query, 'setPermissionMode'>): Promise<void> {
    this.query = query;
    try {
      await query.setPermissionMode('auto');
      this.requireOpen();
      this.autoSupported = true;
    } catch {
      // A rejected capability probe is recoverable only while the CLI is live.
      this.requireOpen();
    }
    const level = this.autonomy.latestAutonomy;
    const planning = this.latestPlanning;
    const mode = this.mode(level, planning);
    await query.setPermissionMode(mode);
    this.requireOpen();
    this.nativeMode = mode;
    this.planning = planning;
    this.autonomy.confirm(level);
    this.noteFallback();
  }

  async change(
    initialized: Promise<void>,
    next: { autonomy?: Autonomy; planning?: boolean },
  ): Promise<void> {
    if (next.autonomy !== undefined) this.autonomy.latestAutonomy = next.autonomy;
    if (next.planning !== undefined) this.latestPlanning = next.planning;
    await initialized;
    this.requireOpen();
    await this.autonomy.synchronize();
    this.noteFallback();
  }

  async startTurn(start: () => void): Promise<void> {
    while (!this.autonomy.isApplied) await this.autonomy.synchronize();
    this.autonomy.requireOpen();
    // A new choice cannot arrive between this check and enqueueing the prompt.
    start();
  }

  selection(): Autonomy {
    return this.autonomy.selection;
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
      this.selection() === 'medium' &&
      !this.planning &&
      !this.autoSupported &&
      !this.noticeReported;
  }
}
