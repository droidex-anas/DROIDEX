import {
  decodeProfilePayload,
  isRecord,
  MAX_PROFILE_PAYLOAD_LENGTH,
  profileChallengeProof,
  profilePublishProof,
  profileRevokeProof,
  profileShareProof,
  publicKey,
  randomNonce,
  signIdentity,
  verifyPublishedProfile,
  type Identity,
  type PublishedProfile,
} from '../../../packages/remote/src/index.js';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_PROFILE_RESPONSE_BYTES = MAX_PROFILE_PAYLOAD_LENGTH + 4096;

export async function readPublishedProfile(
  relayUrl: string,
  username: string,
  identity: Identity,
): Promise<PublishedProfile | null> {
  const response = await fetch(profileUrl(relayUrl, username), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error('Could not load the public profile. Check the relay connection');
  return parseRelayProfile(
    await boundedJson(response, MAX_PROFILE_RESPONSE_BYTES),
    username,
    identity,
  );
}

export async function publishProfile(
  relayUrl: string,
  username: string,
  identity: Identity,
  payload: unknown,
): Promise<PublishedProfile> {
  const encodedPayload = typeof payload === 'string' ? payload : '';
  const profile = decodeProfilePayload(encodedPayload);
  if (profile?.username !== username) throw new Error('Invalid public profile payload');
  const current = await readPublishedProfile(relayUrl, username, identity);
  const challenge = await requestProfileChallenge(relayUrl, username, identity);
  const [signature, authorization] = await Promise.all([
    signIdentity(identity.privateKey, profileShareProof(username, encodedPayload)),
    signIdentity(
      identity.privateKey,
      profilePublishProof(username, challenge, current?.payload ?? null, encodedPayload),
    ),
  ]);
  const response = await fetch(profileUrl(relayUrl, username), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge,
      currentPayload: current?.payload ?? null,
      payload: encodedPayload,
      signature,
      authorization,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 409) {
    throw new Error('The public profile changed. Refresh it and try again');
  }
  if (!response.ok) throw new Error('Could not publish the profile. Check the relay connection');
  return parseRelayProfile(
    await boundedJson(response, MAX_PROFILE_RESPONSE_BYTES),
    username,
    identity,
  );
}

export async function revokeProfile(
  relayUrl: string,
  username: string,
  identity: Identity,
  currentPayload: unknown,
): Promise<void> {
  const encodedPayload = typeof currentPayload === 'string' ? currentPayload : '';
  const profile = decodeProfilePayload(encodedPayload);
  if (profile?.username !== username) throw new Error('Invalid public profile payload');
  const challenge = await requestProfileChallenge(relayUrl, username, identity);
  const authorization = await signIdentity(
    identity.privateKey,
    profileRevokeProof(username, challenge, encodedPayload),
  );
  const response = await fetch(profileUrl(relayUrl, username), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge, currentPayload: encodedPayload, authorization }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 409) {
    throw new Error('The public profile changed. Refresh it before removing it');
  }
  if (!response.ok)
    throw new Error('Could not remove the public profile. Check the relay connection');
}

async function requestProfileChallenge(
  relayUrl: string,
  username: string,
  identity: Identity,
): Promise<string> {
  const nonce = randomNonce();
  const signature = await signIdentity(identity.privateKey, profileChallengeProof(username, nonce));
  const response = await fetch(`${profileBaseUrl(relayUrl, username)}/profile-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, signature }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error('Public profile service unavailable. Check the relay connection');
  const value = await boundedJson(response, 4096);
  if (
    !isRecord(value) ||
    typeof value.challenge !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.challenge)
  ) {
    throw new Error('The relay returned an invalid profile challenge');
  }
  return value.challenge;
}

async function parseRelayProfile(
  value: unknown,
  username: string,
  identity: Identity,
): Promise<PublishedProfile> {
  const published = await verifyPublishedProfile(value, username);
  const expected = publicKey(identity.publicKey);
  if (published?.publicKey.x !== expected.x || published.publicKey.y !== expected.y) {
    throw new Error('The relay returned an invalid public profile');
  }
  return {
    payload: published.payload,
    publicKey: published.publicKey,
    signature: published.signature,
  };
}

function profileUrl(relayUrl: string, username: string): string {
  return `${profileBaseUrl(relayUrl, username)}/profile`;
}

function profileBaseUrl(relayUrl: string, username: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = `/v1/handles/${username}`;
  return url.href.replace(/\/$/, '');
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('The relay response was too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The relay returned an empty response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('The relay response was too large');
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
    throw new Error('The relay returned invalid JSON');
  }
}
