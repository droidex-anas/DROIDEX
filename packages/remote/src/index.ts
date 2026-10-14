export * from './crypto';
export * from './totp';

export const HANDLE_PATTERN = /^[a-z][a-z0-9-]{2,29}$/;
export const MAX_RELAY_FRAME_BYTES = 65_536;

export type RelayMessage =
  | { type: 'relay-ready'; peerId: string; challenge: string }
  | { type: 'host-auth'; publicKey: JsonWebKey; signature: string }
  | { type: 'host-ready' }
  | { type: 'authorize-peer'; peerId: string }
  | { type: 'disconnect-peer'; peerId: string }
  | { type: 'peer-open'; peerId: string }
  | { type: 'peer-close'; peerId: string }
  | { type: 'forward'; peerId?: string; deliveryId?: number; payload: unknown }
  | { type: 'received'; deliveryId: number }
  | { type: 'locked' };
