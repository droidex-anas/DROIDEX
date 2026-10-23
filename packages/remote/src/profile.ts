import { decodeBase64, encodeBase64, profileShareProof, publicKey, verifyIdentity } from './crypto';
import type { UsageBreakdown, UsageDay } from './usage';

const RESERVED_HANDLE_PATTERN = [
  'api',
  'assets',
  'blog',
  'classic',
  'clean',
  'demo',
  'docs',
  'download',
  'help',
  'login',
  'pricing',
  'privacy',
  'projects',
  'public',
  'remote',
  'settings',
  'shell',
  'status',
  'terms',
  'www',
].join('|');

// Public handles and product routes share the droidex.vercel.app top-level namespace.
export const HANDLE_PATTERN = new RegExp(
  `^(?!(?:${RESERVED_HANDLE_PATTERN})$)[a-z][a-z0-9-]{2,29}$`,
);
export const MAX_PROFILE_PAYLOAD_LENGTH = 20 * 1024;

const MAX_DATE_MS = 8_640_000_000_000_000;

export interface ProfileIdentity {
  displayName: string;
  username: string;
}

export type PublicProfileRanking = Pick<UsageBreakdown, 'name' | 'sessions'>;

export interface PublicProfileSnapshot extends ProfileIdentity {
  version: 3;
  generatedAt: number;
  generatedDay: string;
  lifetimeTokens: number;
  tokensReported: boolean;
  tokensComplete: boolean;
  peakDayTokens: number;
  sessions: number;
  currentStreak: number;
  longestStreak: number;
  trackingDay: string;
  days: Pick<UsageDay, 'date' | 'tokens' | 'tokensComplete'>[];
  harnesses: PublicProfileRanking[];
  models: PublicProfileRanking[];
}

export interface PublishedProfile {
  payload: string;
  publicKey: JsonWebKey;
  signature: string;
}

export interface DecodedPublishedProfile extends PublishedProfile {
  profile: PublicProfileSnapshot;
}

type RankingWire = [name: string, sessions: number];
interface ProfileWire {
  v: 3;
  n: string;
  u: string;
  g: number;
  a: string;
  t: string;
  s: [number, boolean, boolean, number, number, number, number];
  d: [date: string, tokens: number, tokensComplete: boolean][];
  h: RankingWire[];
  m: RankingWire[];
}

export function parsePublicProfileSnapshot(value: unknown): PublicProfileSnapshot | null {
  if (!record(value) || value.version !== 3) return null;
  const identity = profileIdentity(value);
  const generatedAt = dateTimestamp(value.generatedAt);
  const generatedDay = calendarDay(value.generatedDay) ? value.generatedDay : null;
  const lifetimeTokens = count(value.lifetimeTokens);
  const peakDayTokens = count(value.peakDayTokens);
  const sessions = count(value.sessions);
  const currentStreak = count(value.currentStreak);
  const longestStreak = count(value.longestStreak);
  const trackingDay = calendarDay(value.trackingDay) ? value.trackingDay : null;
  const days = activityDays(value.days);
  const harnesses = rankings(value.harnesses);
  const models = rankings(value.models);
  if (
    !identity ||
    generatedAt === null ||
    generatedDay === null ||
    lifetimeTokens === null ||
    typeof value.tokensReported !== 'boolean' ||
    typeof value.tokensComplete !== 'boolean' ||
    peakDayTokens === null ||
    sessions === null ||
    currentStreak === null ||
    longestStreak === null ||
    trackingDay === null ||
    !days ||
    !harnesses ||
    !models
  ) {
    return null;
  }
  return {
    version: 3,
    ...identity,
    generatedAt,
    generatedDay,
    lifetimeTokens,
    tokensReported: value.tokensReported,
    tokensComplete: value.tokensComplete,
    peakDayTokens,
    sessions,
    currentStreak,
    longestStreak,
    trackingDay,
    days,
    harnesses,
    models,
  };
}

export function encodeProfilePayload(snapshot: PublicProfileSnapshot): string {
  const safe = parsePublicProfileSnapshot(snapshot);
  if (!safe) throw new Error('The public profile snapshot is invalid.');
  const payload = encodeBase64(new TextEncoder().encode(JSON.stringify(toWire(safe))));
  if (payload.length > MAX_PROFILE_PAYLOAD_LENGTH) {
    throw new Error('This profile snapshot is too large to share.');
  }
  return payload;
}

export function decodePublishedProfile(
  value: unknown,
  expectedUsername?: string,
): DecodedPublishedProfile | null {
  if (!record(value) || typeof value.payload !== 'string' || typeof value.signature !== 'string') {
    return null;
  }
  const profile = decodeProfilePayload(value.payload);
  if (!profile || (expectedUsername !== undefined && profile.username !== expectedUsername)) {
    return null;
  }
  try {
    if (!validSignature(value.signature)) return null;
    return {
      payload: value.payload,
      profile,
      publicKey: publicKey(value.publicKey),
      signature: value.signature,
    };
  } catch {
    return null;
  }
}

export async function verifyPublishedProfile(
  value: unknown,
  expectedUsername?: string,
): Promise<DecodedPublishedProfile | null> {
  const published = decodePublishedProfile(value, expectedUsername);
  if (!published) return null;
  try {
    return (await verifyIdentity(
      published.publicKey,
      profileShareProof(published.profile.username, published.payload),
      published.signature,
    ))
      ? published
      : null;
  } catch {
    return null;
  }
}

export function isProfilePayload(value: unknown): value is string {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PROFILE_PAYLOAD_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  ) {
    try {
      return encodeBase64(decodeBase64(value)) === value;
    } catch {
      return false;
    }
  }
  return false;
}

export function decodeProfilePayload(payload: string): PublicProfileSnapshot | null {
  if (!isProfilePayload(payload)) return null;
  try {
    const bytes = decodeBase64(payload);
    const wire: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return fromWire(wire);
  } catch {
    return null;
  }
}

function profileIdentity(value: Record<string, unknown>): ProfileIdentity | null {
  if (
    !label(value.displayName, 80) ||
    !value.displayName.trim() ||
    typeof value.username !== 'string' ||
    !HANDLE_PATTERN.test(value.username)
  ) {
    return null;
  }
  return { displayName: value.displayName, username: value.username };
}

function activityDays(value: unknown): PublicProfileSnapshot['days'] | null {
  if (!Array.isArray(value) || value.length > 366) return null;
  const result: PublicProfileSnapshot['days'] = [];
  let previous = '';
  for (const item of value) {
    if (!record(item) || !calendarDay(item.date) || item.date <= previous) return null;
    const tokens = count(item.tokens);
    if (tokens === null || typeof item.tokensComplete !== 'boolean') return null;
    result.push({ date: item.date, tokens, tokensComplete: item.tokensComplete });
    previous = item.date;
  }
  return result;
}

function rankings(value: unknown): PublicProfileRanking[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result: PublicProfileRanking[] = [];
  for (const item of value) {
    if (!record(item) || !label(item.name, 160)) return null;
    const sessions = count(item.sessions);
    if (sessions === null) return null;
    result.push({ name: item.name, sessions });
  }
  return result;
}

function toWire(profile: PublicProfileSnapshot): ProfileWire {
  const ranking = ({ name, sessions }: PublicProfileRanking): RankingWire => [name, sessions];
  return {
    v: 3,
    n: profile.displayName,
    u: profile.username,
    g: profile.generatedAt,
    a: profile.generatedDay,
    t: profile.trackingDay,
    s: [
      profile.lifetimeTokens,
      profile.tokensReported,
      profile.tokensComplete,
      profile.peakDayTokens,
      profile.sessions,
      profile.currentStreak,
      profile.longestStreak,
    ],
    d: profile.days.map(({ date, tokens, tokensComplete }) => [date, tokens, tokensComplete]),
    h: profile.harnesses.map(ranking),
    m: profile.models.map(ranking),
  };
}

function fromWire(value: unknown): PublicProfileSnapshot | null {
  if (!record(value) || value.v !== 3 || !wireRows(value.d, 366, 3)) return null;
  if (!wireRows(value.h, 5, 2) || !wireRows(value.m, 5, 2)) return null;
  if (!unknownList(value.s) || value.s.length !== 7) return null;
  return parsePublicProfileSnapshot({
    version: 3,
    displayName: value.n,
    username: value.u,
    generatedAt: value.g,
    generatedDay: value.a,
    trackingDay: value.t,
    lifetimeTokens: value.s[0],
    tokensReported: value.s[1],
    tokensComplete: value.s[2],
    peakDayTokens: value.s[3],
    sessions: value.s[4],
    currentStreak: value.s[5],
    longestStreak: value.s[6],
    days: value.d.map((row) => ({ date: row[0], tokens: row[1], tokensComplete: row[2] })),
    harnesses: value.h.map((row) => ({ name: row[0], sessions: row[1] })),
    models: value.m.map((row) => ({ name: row[0], sessions: row[1] })),
  });
}

function wireRows(value: unknown, limit: number, width: number): value is unknown[][] {
  return (
    unknownList(value) &&
    value.length <= limit &&
    value.every((row) => unknownList(row) && row.length === width)
  );
}

function unknownList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function dateTimestamp(value: unknown): number | null {
  const timestamp = count(value);
  return timestamp !== null && timestamp <= MAX_DATE_MS ? timestamp : null;
}

function label(value: unknown, limit: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function validSignature(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return decodeBase64(value).byteLength === 64;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
