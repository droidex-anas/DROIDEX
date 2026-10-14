const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let result = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  return result;
}

function decodeSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid authenticator secret');
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return new Uint8Array(bytes);
}

export async function totpCode(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeSecret(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setUint32(0, Math.floor(step / 0x100000000));
  view.setUint32(4, step >>> 0);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = hash[19] & 15;
  const number = new DataView(hash.buffer).getUint32(offset) & 0x7fffffff;
  return (number % 1_000_000).toString().padStart(6, '0');
}

/** Returns the matched time step; callers persist it to reject reused codes. */
export async function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  lastStep = -1,
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 30_000);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = await totpCode(secret, step);
    let difference = 0;
    for (let index = 0; index < 6; index++)
      difference |= expected.charCodeAt(index) ^ code.charCodeAt(index);
    if (difference === 0 && step > lastStep) matched = step;
  }
  return matched;
}

export function authenticatorUri(handle: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`Droidex:${handle}`)}?secret=${secret}&issuer=Droidex&algorithm=SHA1&digits=6&period=30`;
}
