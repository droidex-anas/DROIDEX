const encoder = new TextEncoder();
const curve = { name: 'ECDSA', namedCurve: 'P-256' };

export interface Identity {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

export interface HostHello {
  type: 'host-hello';
  version: 1;
  publicKey: JsonWebKey;
  ephemeralKey: JsonWebKey;
  nonce: string;
  signature: string;
}

export interface ClientHello {
  type: 'client-hello';
  version: 1;
  ephemeralKey: JsonWebKey;
  nonce: string;
}

export interface HostHandshake {
  hello: HostHello;
  ephemeralPrivateKey: CryptoKey;
}

export interface CipherFrame {
  type: 'encrypted';
  counter: number;
  ciphertext: string;
}

export interface SecureChannel {
  challenge: string;
  encrypt(value: unknown): Promise<CipherFrame>;
  decrypt(frame: unknown): Promise<unknown>;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomNonce(): string {
  return encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function publicKey(value: unknown): JsonWebKey & { x: string; y: string } {
  if (
    !isRecord(value) ||
    value.kty !== 'EC' ||
    value.crv !== 'P-256' ||
    typeof value.x !== 'string' ||
    typeof value.y !== 'string' ||
    'd' in value ||
    decodeBase64(value.x).length !== 32 ||
    decodeBase64(value.y).length !== 32
  )
    throw new Error('Invalid public key');
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}

function keyText(value: unknown): string {
  const key = publicKey(value);
  return `P-256:${key.x}:${key.y}`;
}

export async function createIdentity(): Promise<Identity> {
  const keys = await crypto.subtle.generateKey(curve, false, ['sign', 'verify']);
  return {
    privateKey: keys.privateKey,
    publicKey: publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)),
  };
}

export async function fingerprint(key: JsonWebKey): Promise<string> {
  return encodeBase64(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(keyText(key)))),
  );
}

export async function signIdentity(key: CryptoKey, message: string): Promise<string> {
  return encodeBase64(
    new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(message)),
    ),
  );
}

export async function verifyIdentity(
  key: JsonWebKey,
  message: string,
  signature: string,
): Promise<boolean> {
  const imported = await crypto.subtle.importKey('jwk', publicKey(key), curve, false, ['verify']);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    imported,
    decodeBase64(signature),
    encoder.encode(message),
  );
}

export function hostProof(handle: string, challenge: string): string {
  return `droidex-remote:host:1|${handle}|${challenge}`;
}

export function claimProof(handle: string, challenge: string): string {
  return `droidex-remote:claim:1|${handle}|${challenge}`;
}

function helloProof(handle: string, hello: Omit<HostHello, 'signature'>): string {
  return `droidex-remote:hello:1|${handle}|${hello.nonce}|${keyText(hello.publicKey)}|${keyText(hello.ephemeralKey)}`;
}

function validNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function ephemeralKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

export async function createHostHello(handle: string, identity: Identity): Promise<HostHandshake> {
  const keys = await ephemeralKeys();
  const unsigned = {
    type: 'host-hello' as const,
    version: 1 as const,
    publicKey: identity.publicKey,
    ephemeralKey: publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    nonce: randomNonce(),
  };
  return {
    hello: {
      ...unsigned,
      signature: await signIdentity(identity.privateKey, helloProof(handle, unsigned)),
    },
    ephemeralPrivateKey: keys.privateKey,
  };
}

export async function acceptHostHello(
  handle: string,
  pin: string,
  value: unknown,
): Promise<{ clientHello: ClientHello; channel: SecureChannel }> {
  if (
    !isRecord(value) ||
    value.type !== 'host-hello' ||
    value.version !== 1 ||
    !validNonce(value.nonce) ||
    typeof value.signature !== 'string'
  ) {
    throw new Error('Invalid laptop handshake');
  }
  const hello: HostHello = {
    type: 'host-hello',
    version: 1,
    nonce: value.nonce,
    signature: value.signature,
    publicKey: publicKey(value.publicKey),
    ephemeralKey: publicKey(value.ephemeralKey),
  };
  if (
    (await fingerprint(hello.publicKey)) !== pin ||
    !(await verifyIdentity(hello.publicKey, helloProof(handle, hello), hello.signature))
  ) {
    throw new Error('Laptop identity changed. Scan the pairing code on your laptop again.');
  }
  const keys = await ephemeralKeys();
  const clientHello: ClientHello = {
    type: 'client-hello',
    version: 1,
    nonce: randomNonce(),
    ephemeralKey: publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)),
  };
  return {
    clientHello,
    channel: await channelFor(handle, hello, clientHello, keys.privateKey, 'client'),
  };
}

export async function finishHostHello(
  handle: string,
  handshake: HostHandshake,
  value: unknown,
): Promise<SecureChannel> {
  if (
    !isRecord(value) ||
    value.type !== 'client-hello' ||
    value.version !== 1 ||
    !validNonce(value.nonce)
  )
    throw new Error('Invalid browser handshake');
  const hello: ClientHello = {
    type: 'client-hello',
    version: 1,
    nonce: value.nonce,
    ephemeralKey: publicKey(value.ephemeralKey),
  };
  return channelFor(handle, handshake.hello, hello, handshake.ephemeralPrivateKey, 'host');
}

async function channelFor(
  handle: string,
  host: HostHello,
  client: ClientHello,
  privateKey: CryptoKey,
  role: 'host' | 'client',
): Promise<SecureChannel> {
  const peerKey = role === 'host' ? client.ephemeralKey : host.ephemeralKey;
  const transcript = `${helloProof(handle, host)}|${client.nonce}|${keyText(client.ephemeralKey)}`;
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(transcript)));
  const imported = await crypto.subtle.importKey(
    'jwk',
    peerKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: imported },
    privateKey,
    256,
  );
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const derive = (direction: string) =>
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: encoder.encode(`droidex-remote:1:${direction}`),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  const [toHost, toClient] = await Promise.all([derive('to-host'), derive('to-client')]);
  const sendKey = role === 'host' ? toClient : toHost;
  const receiveKey = role === 'host' ? toHost : toClient;
  const session = encodeBase64(salt);
  let sent = 0;
  let received = 0;
  let sendQueue: Promise<unknown> = Promise.resolve();
  let receiveQueue: Promise<unknown> = Promise.resolve();
  const nonce = (counter: number) => {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setUint32(8, counter);
    return bytes;
  };
  return {
    challenge: `droidex-remote:device:1|${session}`,
    encrypt(value) {
      const result = sendQueue.then(async () => {
        if (sent >= 0xffffffff) throw new Error('Reconnect to renew encryption keys');
        const plaintext = encoder.encode(JSON.stringify(value));
        if (plaintext.byteLength > 46_000) throw new Error('Remote message too large');
        const counter = sent + 1;
        const encrypted = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: nonce(counter),
            additionalData: encoder.encode(`${session}|${String(counter)}`),
          },
          sendKey,
          plaintext,
        );
        sent = counter;
        return {
          type: 'encrypted' as const,
          counter,
          ciphertext: encodeBase64(new Uint8Array(encrypted)),
        };
      });
      sendQueue = result.catch(() => undefined);
      return result;
    },
    decrypt(frame) {
      const result = receiveQueue.then(async () => {
        if (
          !isRecord(frame) ||
          frame.type !== 'encrypted' ||
          frame.counter !== received + 1 ||
          typeof frame.ciphertext !== 'string' ||
          frame.ciphertext.length > 62_000
        )
          throw new Error('Invalid or replayed remote message');
        const counter = received + 1;
        const plaintext = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: nonce(counter),
            additionalData: encoder.encode(`${session}|${String(counter)}`),
          },
          receiveKey,
          decodeBase64(frame.ciphertext),
        );
        const result: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
        );
        received = counter;
        return result;
      });
      receiveQueue = result.catch(() => undefined);
      return result;
    },
  };
}
