import type { Autonomy } from '../protocol.js';

const LEVELS: readonly Autonomy[] = ['off', 'low', 'medium', 'high'];

export class SessionAutonomy {
  latestAutonomy: Autonomy;
  private confirmedAutonomy: Autonomy;
  private writing?: Promise<void>;
  private stopped = false;

  constructor(
    autonomy: Autonomy,
    private readonly native: {
      // Read latestAutonomy when dispatching, including after other settings writes.
      write(): Promise<Autonomy>;
      isApplied(): boolean;
      isUnsafe(): boolean;
      interrupt(): Promise<void>;
      close(): Promise<void>;
      requireOpen(): void;
    },
  ) {
    this.latestAutonomy = autonomy;
    this.confirmedAutonomy = autonomy;
  }

  get selection(): Autonomy {
    return LEVELS.indexOf(this.latestAutonomy) < LEVELS.indexOf(this.confirmedAutonomy)
      ? this.latestAutonomy
      : this.confirmedAutonomy;
  }

  get inForce(): Autonomy {
    return this.confirmedAutonomy;
  }

  confirm(autonomy: Autonomy): void {
    this.requireOpen();
    this.confirmedAutonomy = autonomy;
  }

  get isApplied(): boolean {
    return (
      !this.writing && this.confirmedAutonomy === this.latestAutonomy && this.native.isApplied()
    );
  }

  set(autonomy: Autonomy): Promise<void> {
    this.latestAutonomy = autonomy;
    return this.synchronize();
  }

  synchronize(): Promise<void> {
    this.requireOpen();
    if (this.writing) return this.writing;
    if (this.confirmedAutonomy === this.latestAutonomy && this.native.isApplied())
      return Promise.resolve();
    this.writing = this.applyLatest();
    return this.writing;
  }

  stop(): void {
    this.stopped = true;
  }

  requireOpen(): void {
    if (this.stopped)
      throw new Error(
        'Autonomy change was interrupted because the session runtime closed. Reopen the chat to continue.',
      );
    this.native.requireOpen();
  }

  private async applyLatest(): Promise<void> {
    let retryLevel: Autonomy | undefined;
    try {
      while (this.confirmedAutonomy !== this.latestAutonomy || !this.native.isApplied()) {
        this.requireOpen();
        const attempted = this.latestAutonomy;
        try {
          const confirmed = await this.native.write();
          this.requireOpen();
          this.confirmedAutonomy = confirmed;
          retryLevel = undefined;
          // An obsolete grant can land after revocation; stop work before repairing it.
          await this.interruptUnsafeRuntime();
          this.requireOpen();
        } catch (error) {
          this.requireOpen();
          await this.interruptUnsafeRuntime(error);
          this.requireOpen();
          // A stale failure still owes the newest choice. Retry a current refusal
          // once; an unapplied revocation cannot leave the runtime alive.
          const hasRetried = retryLevel === this.latestAutonomy;
          if (!hasRetried) {
            retryLevel = attempted === this.latestAutonomy ? attempted : undefined;
            continue;
          }
          // Disarm refused escalations before the next prompt, but keep app-level
          // revocations even when both levels map to the same native policy.
          if (this.native.isUnsafe()) await this.retire();
          else this.latestAutonomy = this.selection;
          throw error;
        }
      }
    } finally {
      this.writing = undefined;
    }
  }

  private async interruptUnsafeRuntime(error?: unknown): Promise<void> {
    if (!this.native.isUnsafe()) return;
    try {
      await this.native.interrupt();
    } catch (interruptError) {
      await this.retire();
      throw error ?? interruptError;
    }
  }

  private async retire(): Promise<void> {
    this.stop();
    await this.native.close();
  }
}
