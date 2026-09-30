import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { droidexUserDataDir } from './droidexPaths.js';
import type { SessionRole, TranscriptEvent } from './protocol.js';
import { dateMs, numberValue, objectValue, stringValue } from './values.js';

interface StoredNoticeLine {
  type: 'status' | 'error';
  id: string;
  timestamp: string;
  text: string;
  modelSwitch?: TranscriptEvent['modelSwitch'];
  errorKind?: TranscriptEvent['errorKind'];
  resetsAt?: number;
  compactType?: TranscriptEvent['compactType'];
}

// The one gate deciding which notices outlive the run: every error row, and
// every status row except the live progress lines marked transient.
export function storedNoticeLine(event: TranscriptEvent): StoredNoticeLine | undefined {
  if (event.kind !== 'status' && event.kind !== 'error') return undefined;
  if (event.transient) return undefined;
  return {
    type: event.kind,
    id: event.id,
    timestamp: new Date(event.ts).toISOString(),
    text: event.text ?? '',
    ...(event.modelSwitch ? { modelSwitch: event.modelSwitch } : {}),
    ...(event.errorKind ? { errorKind: event.errorKind } : {}),
    ...(event.resetsAt !== undefined ? { resetsAt: event.resetsAt } : {}),
    ...(event.compactType ? { compactType: event.compactType } : {}),
  };
}

export function parseStoredNotice(
  appSessionId: string,
  providerSessionId: string,
  role: SessionRole,
  value: unknown,
): TranscriptEvent | undefined {
  const line = objectValue(value);
  if (!line || (line.type !== 'status' && line.type !== 'error')) return undefined;
  const id = stringValue(line.id);
  const text = stringValue(line.text);
  const ts = dateMs(stringValue(line.timestamp));
  if (!id || text === undefined || !Number.isFinite(ts)) return undefined;
  const modelSwitch = objectValue(line.modelSwitch);
  const from = stringValue(modelSwitch?.from);
  const to = stringValue(modelSwitch?.to);
  const resetsAt = numberValue(line.resetsAt);
  return {
    id,
    appSessionId,
    sourceSessionId: role === 'primary' ? appSessionId : providerSessionId,
    role,
    ts,
    kind: line.type,
    text,
    ...(line.type === 'error' ? { isError: true } : {}),
    ...(line.type === 'status' && from && to ? { modelSwitch: { from, to } } : {}),
    ...(line.type === 'error' && line.errorKind === 'usage_limit'
      ? { errorKind: 'usage_limit', ...(resetsAt !== undefined ? { resetsAt } : {}) }
      : {}),
    ...(line.compactType === 'auto' || line.compactType === 'manual'
      ? { compactType: line.compactType }
      : {}),
  };
}

function noticesPath(providerSessionId: string): string {
  return join(
    droidexUserDataDir(),
    'session-notices',
    `${encodeURIComponent(providerSessionId)}.jsonl`,
  );
}

// Droid owns its transcript. App notices live separately so they never enter
// the harness's resume input or change a provider-owned record.
export function appendSessionNotice(providerSessionId: string, event: TranscriptEvent): void {
  const line = storedNoticeLine(event);
  if (!line) return;
  mkdirSync(join(droidexUserDataDir(), 'session-notices'), { recursive: true });
  appendFileSync(noticesPath(providerSessionId), `${JSON.stringify(line)}\n`);
}

export function removeSessionNotices(providerSessionId: string): void {
  rmSync(noticesPath(providerSessionId), { force: true });
}

export function sessionNoticesRevision(providerSessionId: string): string {
  try {
    const stat = statSync(noticesPath(providerSessionId));
    return `${String(stat.mtimeMs)}:${String(stat.size)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export function readSessionNotices(
  appSessionId: string,
  providerSessionId: string,
  role: SessionRole,
): TranscriptEvent[] {
  let text: string;
  try {
    text = readFileSync(noticesPath(providerSessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const notices: TranscriptEvent[] = [];
  for (const row of text.split('\n')) {
    if (!row.trim()) continue;
    try {
      const notice = parseStoredNotice(appSessionId, providerSessionId, role, JSON.parse(row));
      if (notice) notices.push(notice);
    } catch {
      // A torn final record must not hide earlier notices.
    }
  }
  return notices.sort((left, right) => left.ts - right.ts);
}
