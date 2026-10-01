// Each harness account's usage, kept current from the windows a harness
// pushes, a read after every turn, a light read every few minutes and the
// renderer's asks. Reads go through a live session's own connection; only an
// open /usage with no live session may start a short-lived harness process.
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
  // Ends the account's reads when the sidecar closes or another account
  // signs in; what they answer is dropped.
  readonly abort: AbortController;
  usage?: ProviderUsage;
  lastReadAt: number;
  retryAt: number;
  emittedAt: number;
  // The read whose answer is awaited.
  reading?: Promise<void>;
  // Set until a read's source settles, which one a harness cannot cancel may
  // do after its timeout; no other read starts meanwhile, so none pile up.
  outstanding: boolean;
  // The windows pushed since the last read began, which are newer than its answer.
  pushedDuringRead: Set<string>;
}

type UsageSource = (signal: AbortSignal) => Promise<UsageReading>;

export class AccountUsage {
  private readonly accounts = new Map<ProviderKind, Account>();
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly host: AccountUsageHost,
    private readonly now: () => number = Date.now,
  ) {}

  refresh(
    provider: ProviderKind,
    { panelOpen, immediate }: { panelOpen: boolean; immediate: boolean },
  ): Promise<void> {
    const reading = this.read(provider, panelOpen, immediate);
    if (reading) return reading;
    // What is already known still answers a renderer that has nothing yet.
    const account = this.accounts.get(provider);
    if (account?.usage) this.publish(account, account.usage);
    return Promise.resolve();
  }

  afterTurn(provider: ProviderKind): void {
    void this.read(provider, false, false);
  }

  // Codex sends its windows with nearly every token, so an unchanged push is
  // only announced once the last announcement has aged.
  pushed(provider: ProviderKind, meters: ReportedMeter[]): void {
    if (this.closed || meters.length === 0) return;
    this.startTimer();
    const account = this.account(provider);
    const current = account.usage ?? { provider, meters: [] };
    const now = this.now();
    const changed = meters.some((meter) => {
      const known = current.meters.find((entry) => entry.id === meter.id);
      return known?.usedPercent !== meter.usedPercent || known.resetsAt !== meter.resetsAt;
    });
    const usage = { ...current, meters: mergeMeters(current.meters, stamped(meters, now)) };
    account.usage = usage;
    for (const meter of meters) account.pushedDuringRead.add(meter.id);
    if (changed || now - account.emittedAt >= MIN_READ_GAP_MS) this.publish(account, usage);
  }

  // Another Factory key was set: nothing read with the last one, pending or
  // kept, is this account's. A renderer shown the old figures gets new ones.
  factoryKeyChanged(): void {
    const previous = this.accounts.get('droid');
    previous?.abort.abort();
    this.accounts.delete('droid');
    if (previous?.usage) void this.read('droid', true, true);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const account of this.accounts.values()) account.abort.abort();
  }

  // The read in flight, or a new one; undefined when none may run now.
  private read(
    provider: ProviderKind,
    panelOpen: boolean,
    immediate: boolean,
  ): Promise<void> | undefined {
    if (this.closed) return undefined;
    const account = this.account(provider);
    if (account.reading) return account.reading;
    const now = this.now();
    const source = this.source(provider, panelOpen);
    const resting = !immediate && now - account.lastReadAt < MIN_READ_GAP_MS;
    if (!source || account.outstanding || resting || now < account.retryAt) return undefined;
    this.startTimer();
    account.lastReadAt = now;
    account.outstanding = true;
    account.pushedDuringRead.clear();
    const signal = AbortSignal.any([account.abort.signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);
    const answer = source(signal).finally(() => {
      account.outstanding = false;
    });
    const reading = this.settle(provider, account, untilAborted(answer, signal));
    account.reading = reading.finally(() => {
      account.reading = undefined;
    });
    return account.reading;
  }

  // A live session reads through its own connection. Droid's read is a plain
  // HTTP call, which a live session or an open panel lets run; otherwise only
  // an open panel may start a harness process to read with.
  private source(provider: ProviderKind, panelOpen: boolean): UsageSource | undefined {
    const live = this.host.liveSession(provider);
    const usage = live?.usage;
    if (usage) return (signal) => usage.read(signal);
    if (live || panelOpen) return (signal) => this.host.readWithoutSession(provider, signal);
    return undefined;
  }

  // A read replaces what was known, but a window pushed after it began is
  // newer than its answer, and one a partial reading leaves out is unknown
  // rather than gone. A failed read keeps the last good meters, stale.
  private async settle(
    provider: ProviderKind,
    account: Account,
    answer: Promise<UsageReading>,
  ): Promise<void> {
    let usage: ProviderUsage;
    try {
      const { meters, extra, unavailable, partial } = await answer;
      const listed = new Set(meters.map((meter) => meter.id));
      const kept = (account.usage?.meters ?? []).filter(
        (meter) =>
          account.pushedDuringRead.has(meter.id) || (partial === true && !listed.has(meter.id)),
      );
      usage = {
        provider,
        meters: mergeMeters(stamped(meters, this.now()), kept),
        ...(extra ? { extra } : {}),
        ...(unavailable ? { unavailable } : {}),
      };
    } catch (error) {
      if (error instanceof UsageReadError)
        account.retryAt = this.now() + Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
      usage = { ...(account.usage ?? { provider, meters: [] }), stale: true };
    }
    if (account.abort.signal.aborted) return;
    account.usage = usage;
    this.publish(account, usage);
  }

  private publish(account: Account, usage: ProviderUsage): void {
    account.emittedAt = this.now();
    this.host.emit({ type: 'usage.updated', usage });
  }

  private account(provider: ProviderKind): Account {
    let account = this.accounts.get(provider);
    if (!account) {
      account = {
        abort: new AbortController(),
        lastReadAt: -Infinity,
        retryAt: 0,
        emittedAt: 0,
        outstanding: false,
        pushedDuringRead: new Set(),
      };
      this.accounts.set(provider, account);
    }
    return account;
  }

  // Started by a read or push, so an app that never opens a session or /usage
  // never ticks. Each tick reads through the live sessions, and with none left
  // the timer stops until the next read or push.
  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const live = PROVIDER_KINDS.filter((provider) => this.host.liveSession(provider));
      if (live.length === 0) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      for (const provider of live) void this.read(provider, false, false);
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
