import { HANDLE_PATTERN } from '../../../packages/remote/src';

export interface ProfileIdentity {
  displayName: string;
  username: string;
}

export interface ProfileUsageRecord {
  id: string;
  provider: 'droid' | 'claude' | 'codex';
  modelId?: string;
  tokens: number;
  createdAt: number;
}

export interface ProfileUsageSnapshot {
  lifetimeTokens: number;
  peakDayTokens: number;
  sessions: number;
  currentStreak: number;
  longestStreak: number;
  trackingSince: number;
  days: { date: string; tokens: number }[];
  harnesses: { name: string; sessions: number }[];
  models: { name: string; sessions: number }[];
}

export interface PublicProfileSnapshot extends ProfileUsageSnapshot, ProfileIdentity {
  version: 1;
  generatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function rankings(value: unknown): { name: string; sessions: number }[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.name !== 'string' ||
      row.name.length > 160 ||
      !count(row.sessions)
    )
      return null;
    result.push({ name: row.name, sessions: row.sessions });
  }
  return result;
}

function identity(value: Record<string, unknown>): ProfileIdentity | null {
  if (
    typeof value.displayName !== 'string' ||
    value.displayName.length > 80 ||
    typeof value.username !== 'string' ||
    !HANDLE_PATTERN.test(value.username)
  )
    return null;
  return { displayName: value.displayName, username: value.username };
}

function activityDays(value: unknown): ProfileUsageSnapshot['days'] | null {
  if (!Array.isArray(value) || value.length > 366) return null;
  const days = [];
  for (const day of value) {
    if (
      !isRecord(day) ||
      typeof day.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      !count(day.tokens)
    )
      return null;
    days.push({ date: day.date, tokens: day.tokens });
  }
  return days;
}

// This allowlist is also the sharing boundary: no session IDs, titles,
// transcripts, file paths, credentials, or additional caller fields survive.
function publicSnapshot(value: unknown): PublicProfileSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const profile = identity(value);
  if (!profile) return null;
  const {
    generatedAt,
    lifetimeTokens,
    peakDayTokens,
    sessions,
    currentStreak,
    longestStreak,
    trackingSince,
  } = value;
  if (
    !count(generatedAt) ||
    !count(lifetimeTokens) ||
    !count(peakDayTokens) ||
    !count(sessions) ||
    !count(currentStreak) ||
    !count(longestStreak) ||
    !count(trackingSince)
  )
    return null;
  const days = activityDays(value.days);
  const harnesses = rankings(value.harnesses);
  const models = rankings(value.models);
  if (!days || !harnesses || !models) return null;
  return {
    version: 1,
    ...profile,
    generatedAt,
    lifetimeTokens,
    peakDayTokens,
    sessions,
    currentStreak,
    longestStreak,
    trackingSince,
    days,
    harnesses,
    models,
  };
}

export function encodeProfileSnapshot(snapshot: PublicProfileSnapshot): string {
  const safe = publicSnapshot(snapshot);
  if (!safe) throw new Error('Complete your name and username before sharing your profile.');
  const bytes = new TextEncoder().encode(JSON.stringify(safe));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  if (encoded.length > 32_768) throw new Error('This profile snapshot is too large to share.');
  return encoded;
}

export function decodeProfileSnapshot(fragment: string): PublicProfileSnapshot | null {
  const encoded = fragment.replace(/^#/, '');
  if (encoded.length === 0 || encoded.length > 32_768 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    return null;
  try {
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return publicSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}
