import {
  isRecord,
  profileShareProof,
  verifyIdentity,
  type DecodedProfileShare,
} from '../../packages/remote/src';

export async function verifyProfileShare(share: DecodedProfileShare): Promise<boolean> {
  try {
    const signatureValid = await verifyIdentity(
      share.publicKey,
      profileShareProof(share.profile.username, share.payload),
      share.signature,
    );
    if (!signatureValid) return false;
    const response = await fetch(profileKeyUrl(share.profile.username), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: share.publicKey }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const value: unknown = await response.json();
    return isRecord(value) && value.valid === true;
  } catch {
    return false;
  }
}

function profileKeyUrl(username: string): string {
  const configured = import.meta.env.VITE_REMOTE_RELAY_URL as string | undefined;
  const url = new URL(configured?.trim() ? configured : window.location.origin);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  url.pathname = `/v1/handles/${encodeURIComponent(username)}/profile-key`;
  url.search = '';
  url.hash = '';
  return url.href;
}
