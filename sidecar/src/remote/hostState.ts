import { z } from 'zod';
import { HANDLE_PATTERN, publicKey, type Identity } from '../../../packages/remote/src/index.js';
import type { RemoteDevice, RemoteSettings } from '../../../packages/remote/src/desktop.js';
export const settingsSchema = z
  .object({
    profile: z.object({
      displayName: z.string().trim().max(80),
      username: z.union([z.literal(''), z.string().regex(HANDLE_PATTERN)]),
    }),
    enabled: z.boolean(),
    relayUrl: z.string().max(500),
    clientUrl: z.string().max(500),
    trustDays: z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)]),
    keepAwake: z.boolean(),
    workspace: z.string().max(4096),
  })
  .strict();
export const privateKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string(),
  y: z.string(),
  d: z.string(),
  ext: z.boolean().optional(),
  key_ops: z.array(z.string()).optional(),
});
const subscriptionSchema = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
const deviceSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  publicKey: z.record(z.unknown()),
  expiresAt: z.number().finite(),
  lastSeenAt: z.number().finite(),
});
const storageSchema = z
  .object({
    settings: settingsSchema,
    privateKey: privateKeySchema.optional(),
    usernameClaimed: z.boolean().default(false),
    pushIdentity: z.object({ privateKey: privateKeySchema, publicKey: z.string() }).optional(),
    subscriptions: z.record(subscriptionSchema),
    secret: z
      .string()
      .regex(/^[A-Z2-7]{32}$/)
      .optional(),
    authenticatorReady: z.boolean(),
    lastStep: z.number().int(),
    failures: z.number().int().min(0).max(5),
    lockedUntil: z.number().finite(),
    devices: z.array(deviceSchema).max(20),
  })
  .strict();
export type Stored = Omit<z.infer<typeof storageSchema>, 'devices' | 'privateKey'> & {
  devices: RemoteDevice[];
  privateKey?: JsonWebKey;
};

export function validateUrls(settings: RemoteSettings): void {
  for (const [value, protocols] of [
    [settings.relayUrl, ['wss:']],
    [settings.clientUrl, ['https:']],
  ] as const) {
    if (!value) {
      if (settings.enabled) throw new Error('Configure the relay and web client addresses');
      continue;
    }
    const url = new URL(value);
    const local =
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      (url.protocol === 'ws:' || url.protocol === 'http:');
    if (
      (!protocols.some((protocol) => protocol === url.protocol) && !local) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    )
      throw new Error('Use a secure relay/client origin without a path');
  }
}
export async function importIdentity(value: JsonWebKey): Promise<Identity> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    value,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return {
    privateKey,
    publicKey: publicKey({ kty: value.kty, crv: value.crv, x: value.x, y: value.y }),
  };
}

export async function loadHostState(
  load: () => Promise<string | null>,
  defaults: { relayUrl: string; clientUrl: string },
): Promise<Stored> {
  const stored = await load();
  let state: Stored;
  if (stored) {
    const parsed = storageSchema.parse(JSON.parse(stored));
    state = {
      ...parsed,
      devices: parsed.devices.map((device) => ({
        ...device,
        publicKey: publicKey(device.publicKey),
      })),
    };
  } else
    state = {
      settings: {
        profile: { displayName: '', username: '' },
        enabled: false,
        relayUrl: defaults.relayUrl,
        clientUrl: defaults.clientUrl,
        trustDays: 7,
        keepAwake: false,
        workspace: '',
      },
      authenticatorReady: false,
      usernameClaimed: false,
      lastStep: -1,
      failures: 0,
      lockedUntil: 0,
      devices: [],
      subscriptions: {},
    };
  return state;
}
