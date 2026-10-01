// Each harness account's usage, kept current while DROIDEX runs: the windows a
// harness pushes as they change, a read after every turn, a light read every
// few minutes, and a read whenever the renderer asks. Reads go through a live
// session's own connection; only an open /usage with no live session to read
// through may start a short-lived harness process. Nothing runs before the
// first session or /usage.
import type { ProviderUsage, ServerEvent, UsageMeter } from '../protocol.js';
import { PROVIDER_KINDS, type ProviderKind } from './providerKind.js';
import type { ProviderSession, ReportedMeter, UsageReading } from './session.js';

const REFRESH_INTERVAL_MS = 5 * 60_000;
// Automatic reads closer together than this keep the last answer. Claude Code
// itself answers repeat reads within a minute from its own cache.
const MIN_READ_GAP_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;
// A server's wait is honoured in full, up to a day.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

// A read the server turned away for now, saying how long to wait.
export class UsageReadError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

export interface AccountUsageHost {
  // A live session on the harness, if any. Its connection serves the read; for
  // Droid, whose sessions have none, it only says a session is open.
  liveSession(provider: ProviderKind): Pick<ProviderSession, 'usage'> | undefined;
  readWithoutSession(provider: ProviderKind, signal: AbortSignal): Promise<UsageReading>;
  emit(event: ServerEvent): void;
}

interface Account {
  usage?: ProviderUsage;
  lastReadAt: number;
  retryAt: number;
  emittedAt: number;
  reading?: Promise<void>;
}

type UsageSource = (signal: AbortSignal) => Promise<UsageReading>;

export class AccountUsage {
  private readonly accounts = new Map<ProviderKind, Account>();
  private readonly abort = new AbortController();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly host: AccountUsageHost,
    private readonly now: () => number = Date.now,
  ) {}

  // The renderer asks: /usage opened or its Refresh was pressed (`immediate`),
  // the window came back into focus, or a chat on this harness came up.
  refresh(
    provider: ProviderKind,
    { panelOpen, immediate }: { panelOpen: boolean; immediate: boolean },
  ): Promise<void> {
    const reading = this.read(provider, panelOpen, immediate);
    if (reading) return reading;
    // What is already known still answers a renderer that has nothing yet.
    const known = this.accounts.get(provider)?.usage;
    if (known) this.publish(known);
    return Promise.resolve();
  }

  afterTurn(provider: ProviderKind): void {
    void this.read(provider, false, false);
  }

  // Codex sends its windows with nearly every token, so an unchanged push is
  // only announced once the last announcement has aged.
  pushed(provider: ProviderKind, meters: ReportedMeter[]): void {
    if (this.abort.signal.aborted || meters.length === 0) return;
    this.startTimer();
    const account = this.account(provider);
    const current = account.usage ?? { provider, meters: [] };
    const now = this.now();
    const changed = meters.some((meter) => {
      const known = current.meters.find((entry) => entry.id === meter.id);
      return known?.usedPercent !== meter.usedPercent || known.resetsAt !== meter.resetsAt;
    });
    account.usage = { ...current, meters: mergeMeters(current.meters, stamped(meters, now)) };
    if (changed || now - account.emittedAt >= MIN_READ_GAP_MS) this.publish(account.usage);
  }

  close(): void {
    clearInterval(this.timer);
    this.abort.abort();
  }

  // The read in flight, or a new one; undefined when none may run now.
  private read(
    provider: ProviderKind,
    panelOpen: boolean,
    immediate: boolean,
  ): Promise<void> | undefined {
    if (this.abort.signal.aborted) return undefined;
    const account = this.account(provider);
    if (account.reading) return account.reading;
    const now = this.now();
    const source = this.source(provider, panelOpen);
    const resting = !immediate && now - account.lastReadAt < MIN_READ_GAP_MS;
    if (!source || resting || now < account.retryAt) return undefined;
    this.startTimer();
    account.lastReadAt = now;
    const reading = this.settle(provider, account, source, now).finally(() => {
      account.reading = undefined;
    });
    account.reading = reading;
    return reading;
  }

  // A live session reads through its own connection. Droid's read is a plain
  // HTTP call, which a live session or an open panel lets run; otherwise only
  // an open panel may start a harness process to read with.
  private source(provider: ProviderKind, panelOpen: boolean): UsageSource | undefined {
    const live = this.host.liveSession(provider);
    const usage = live?.usage;
    if (usage) return () => usage.read();
    if (live || panelOpen) return (signal) => this.host.readWithoutSession(provider, signal);
    return undefined;
  }

  // A read replaces what was known, but a window pushed after it began is
  // newer than its answer. A failed read keeps the last good meters, stale.
  private async settle(
    provider: ProviderKind,
    account: Account,
    source: UsageSource,
    startedAt: number,
  ): Promise<void> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);
    let usage: ProviderUsage;
    try {
      const { meters, extra, unavailable } = await untilAborted(source(signal), signal);
      const pushed = (account.usage?.meters ?? []).filter((meter) => meter.updatedAt >= startedAt);
      usage = {
        provider,
        meters: mergeMeters(stamped(meters, this.now()), pushed),
        ...(extra ? { extra } : {}),
        ...(unavailable ? { unavailable } : {}),
      };
    } catch (error) {
      if (this.abort.signal.aborted) return;
      if (error instanceof UsageReadError)
        account.retryAt = this.now() + Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
      usage = { ...(account.usage ?? { provider, meters: [] }), stale: true };
    }
    account.usage = usage;
    this.publish(usage);
  }

  private publish(usage: ProviderUsage): void {
    if (this.abort.signal.aborted) return;
    this.account(usage.provider).emittedAt = this.now();
    this.host.emit({ type: 'usage.updated', usage });
  }

  private account(provider: ProviderKind): Account {
    let account = this.accounts.get(provider);
    if (!account) {
      account = { lastReadAt: -Infinity, retryAt: 0, emittedAt: 0 };
      this.accounts.set(provider, account);
    }
    return account;
  }

  // Started by the first read or push, so an app that never opens a session
  // or /usage never ticks. Each tick reads only through live sessions, and
  // once nothing is live it reads nothing.
  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const provider of PROVIDER_KINDS)
        if (this.host.liveSession(provider)) void this.read(provider, false, false);
    }, REFRESH_INTERVAL_MS);
    this.timer.unref();
  }
}

function stamped(meters: ReportedMeter[], updatedAt: number): UsageMeter[] {
  return meters.map((meter) => ({ ...meter, updatedAt }));
}

// Each incoming window replaces the one with its id; the rest keep their place.
function mergeMeters(current: UsageMeter[], incoming: UsageMeter[]): UsageMeter[] {
  const byId = new Map(current.map((meter) => [meter.id, meter]));
  for (const meter of incoming) byId.set(meter.id, meter);
  return [...byId.values()];
}

// A live session's read may never answer; the read gives up with the signal.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('The usage read did not answer.'));
      });
    }),
  ]);
}
