export const REMOTE_VERSION = 1;
export const MAX_REMOTE_PLAINTEXT_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface SealedPacket {
  v: 1;
  sequence: number;
  ciphertext: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodeBytes(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encoded value.');
  const raw = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function randomSecret(bytes = 32): string {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function importRemoteKey(secret: string): Promise<CryptoKey> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid device key.');
  const bytes = decodeBytes(secret);
  if (bytes.length !== 32) throw new Error('Invalid device key.');
  return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
}

/** Each connection needs fresh contributions from BOTH peers, including reconnects. */
export async function createRemoteChannel(
  key: CryptoKey,
  clientNonce: string,
  hostNonce: string,
  role: 'host' | 'client',
) {
  if (![clientNonce, hostNonce].every((nonce) => /^[A-Za-z0-9_-]{22}$/.test(nonce))) {
    throw new Error('Invalid connection nonce.');
  }
  const salt = encoder.encode(`${clientNonce}.${hostNonce}`);
  const derive = (direction: string) => crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(`droidex-remote-v1:${direction}`) },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const [sendKey, receiveKey] = await Promise.all([
    derive(role === 'host' ? 'host-to-client' : 'client-to-host'),
    derive(role === 'host' ? 'client-to-host' : 'host-to-client'),
  ]);
  let sent = 0;
  let received = 0;
  let sendTail = Promise.resolve();
  let receiveTail = Promise.resolve();

  function iv(sequence: number): Uint8Array {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setBigUint64(4, BigInt(sequence));
    return bytes;
  }

  return {
    seal(value: unknown): Promise<SealedPacket> {
      const result = sendTail.then(async () => {
        const plaintext = encoder.encode(JSON.stringify(value));
        if (plaintext.length > MAX_REMOTE_PLAINTEXT_BYTES) throw new Error('Remote message is too large.');
        const sequence = ++sent;
        if (!Number.isSafeInteger(sequence)) throw new Error('Reconnect required.');
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv(sequence), additionalData: encoder.encode('droidex-remote-v1') },
          sendKey,
          plaintext,
        );
        return { v: REMOTE_VERSION, sequence, ciphertext: encodeBytes(new Uint8Array(ciphertext)) };
      });
      sendTail = result.then(() => undefined, () => undefined);
      return result;
    },
    open(packet: unknown): Promise<unknown> {
      const result = receiveTail.then(async () => {
        if (!isRecord(packet) || packet.v !== REMOTE_VERSION || packet.sequence !== received + 1 ||
            typeof packet.ciphertext !== 'string' || packet.ciphertext.length > (MAX_REMOTE_PLAINTEXT_BYTES + 16) * 4 / 3 + 4) {
          throw new Error('Invalid or replayed remote frame.');
        }
        const ciphertext = decodeBytes(packet.ciphertext);
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv(received + 1), additionalData: encoder.encode('droidex-remote-v1') },
          receiveKey,
          ciphertext,
        );
        const value: unknown = JSON.parse(decoder.decode(plaintext));
        received += 1;
        return value;
      });
      receiveTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export function remoteEndpoint(value: string, kind: 'web' | 'socket'): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = kind === 'web' ? 'https:' : 'wss:';
  const local = kind === 'web' ? 'http:' : 'ws:';
  if ((url.protocol !== secure && !(loopback && url.protocol === local)) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a secure URL, or a loopback URL for local access.');
  }
  return url;
}
