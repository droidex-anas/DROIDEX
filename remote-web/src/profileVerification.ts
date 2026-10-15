import {
  HANDLE_PATTERN,
  MAX_PROFILE_PAYLOAD_LENGTH,
  verifyPublishedProfile,
  type PublicProfileSnapshot,
} from '../../packages/remote/src';

const MAX_PROFILE_RESPONSE_BYTES = MAX_PROFILE_PAYLOAD_LENGTH + 4096;

const DEFAULT_RELAY_URL = 'https://droidex-relay.mdanas7869292.workers.dev';

export type ProfileLoadResult =
  | { status: 'verified'; profile: PublicProfileSnapshot }
  | { status: 'not-published' }
  | { status: 'unavailable' }
  | { status: 'unverified' };

interface ProfileSource {
  relayUrl?: string;
  request?: (url: URL, init: RequestInit) => Promise<Response>;
}

export async function loadPublishedProfile(
  username: string,
  signal: AbortSignal,
  source: ProfileSource = {},
): Promise<ProfileLoadResult> {
  if (!HANDLE_PATTERN.test(username)) return { status: 'unverified' };
  try {
    const response = await (source.request ?? fetch)(profileUrl(username, source), {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    if (response.status === 404) return { status: 'not-published' };
    if (!response.ok) return { status: 'unavailable' };
    const value = await boundedJson(response);
    if (value === null) return { status: 'unverified' };
    const published = await verifyPublishedProfile(value, username);
    return published
      ? { status: 'verified', profile: published.profile }
      : { status: 'unverified' };
  } catch {
    return { status: 'unavailable' };
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROFILE_RESPONSE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_PROFILE_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function profileUrl(username: string, source: ProfileSource): URL {
  const configured: unknown = source.relayUrl ?? import.meta.env.VITE_REMOTE_RELAY_URL;
  const relayUrl = typeof configured === 'string' ? configured : '';
  const base = relayUrl.trim();
  const url = new URL(base.length > 0 ? base : DEFAULT_RELAY_URL);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  url.pathname = `/v1/handles/${encodeURIComponent(username)}/profile`;
  url.search = '';
  url.hash = '';
  return url;
}
