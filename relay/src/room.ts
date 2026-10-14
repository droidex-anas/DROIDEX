import {
  claimProof,
  fingerprint,
  hostProof,
  isRecord,
  MAX_RELAY_FRAME_BYTES,
  publicKey,
  randomNonce,
  verifyIdentity,
} from '../../packages/remote/src/index';
import type { ObjectState, RelaySocket } from './runtime';

interface Owner {
  handle: string;
  key: JsonWebKey;
  fingerprint: string;
}

interface Peer {
  id: string;
  handle: string;
  host: boolean;
  authorized: boolean;
  challenge: string;
  openedAt: number;
  windowAt: number;
  messages: number;
  bytes: number;
  deliveryId: number;
  outstanding: { id: number; bytes: number }[];
}

interface ClaimChallenge {
  nonce: string;
  expiresAt: number;
}

const locked = () => Response.json({ status: 'locked' }, { status: 403 });
const encode = (message: unknown) => JSON.stringify(message);
const encoder = new TextEncoder();
const bytes = (message: string) => encoder.encode(message).byteLength;

function isPeerAttachment(value: unknown): value is Peer {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.handle === 'string' &&
    typeof value.host === 'boolean' &&
    typeof value.authorized === 'boolean' &&
    typeof value.challenge === 'string' &&
    typeof value.openedAt === 'number' &&
    typeof value.windowAt === 'number' &&
    typeof value.messages === 'number' &&
    typeof value.bytes === 'number' &&
    typeof value.deliveryId === 'number' &&
    Array.isArray(value.outstanding) &&
    value.outstanding.every(
      (item: unknown) =>
        isRecord(item) && typeof item.id === 'number' && typeof item.bytes === 'number',
    )
  );
}

async function smallBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new Error('Request too large');
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result));
}

export class RelayRoom {
  private owner: Owner | undefined;
  private peers = new Map<RelaySocket, Peer>();
  private alarmAt: number | null = null;

  constructor(private state: ObjectState) {
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void state.blockConcurrencyWhile(async () => {
      this.owner = await state.storage.get<Owner>('owner');
      this.alarmAt = await state.storage.getAlarm();
      for (const socket of state.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (isPeerAttachment(attachment)) this.peers.set(socket, attachment);
        else socket.close(1011, 'Reconnect');
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.split('/');
    const handle = path[3];
    if (
      path[4] === 'socket' &&
      request.method === 'GET' &&
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ) {
      if (this.peers.size >= 33) return Response.json({ status: 'locked' }, { status: 429 });
      const pair = new WebSocketPair();
      const now = Date.now();
      const peer: Peer = {
        id: crypto.randomUUID(),
        handle,
        host: false,
        authorized: false,
        challenge: randomNonce(),
        openedAt: now,
        windowAt: now,
        messages: 0,
        bytes: 0,
        deliveryId: 0,
        outstanding: [],
      };
      this.state.acceptWebSocket(pair[1]);
      this.peers.set(pair[1], peer);
      pair[1].serializeAttachment(peer);
      await this.scheduleExpiry(now + 120_000);
      pair[1].send(encode({ type: 'relay-ready', peerId: peer.id, challenge: peer.challenge }));
      this.host()?.send(encode({ type: 'peer-open', peerId: peer.id }));
      const response: ResponseInit & { webSocket: RelaySocket } = {
        status: 101,
        webSocket: pair[0],
      };
      return new Response(null, response);
    }
    if (request.method !== 'POST') return locked();
    if (path[4] === 'profile-key') {
      try {
        const body = await smallBody(request);
        const candidate = publicKey(isRecord(body) ? body.publicKey : undefined);
        const candidateFingerprint = await fingerprint(candidate);
        const owner = this.owner;
        const valid = owner?.handle === handle && candidateFingerprint === owner.fingerprint;
        return Response.json({ valid });
      } catch {
        return Response.json({ valid: false });
      }
    }
    try {
      if (path[4] === 'challenge') {
        return await this.state.blockConcurrencyWhile(async () => {
          const challenges = (
            (await this.state.storage.get<ClaimChallenge[]>('challenges')) ?? []
          ).filter((item) => item.expiresAt > Date.now());
          if (challenges.length >= 8) return locked();
          const challenge = { nonce: randomNonce(), expiresAt: Date.now() + 60_000 };
          await this.state.storage.put('challenges', [...challenges, challenge]);
          return Response.json({ challenge: challenge.nonce });
        });
      }
      if (path[4] !== 'claim') return locked();
      const body = await smallBody(request);
      if (
        !isRecord(body) ||
        typeof body.challenge !== 'string' ||
        typeof body.signature !== 'string'
      )
        return locked();
      const key = publicKey(body.publicKey);
      const signature = body.signature;
      const challenge = body.challenge;
      return await this.state.blockConcurrencyWhile(async () => {
        const challenges = (await this.state.storage.get<ClaimChallenge[]>('challenges')) ?? [];
        const valid = challenges.some(
          (item) => item.nonce === challenge && item.expiresAt > Date.now(),
        );
        await this.state.storage.put(
          'challenges',
          challenges.filter((item) => item.nonce !== challenge && item.expiresAt > Date.now()),
        );
        if (!valid || !(await verifyIdentity(key, claimProof(handle, challenge), signature)))
          return locked();
        const pin = await fingerprint(key);
        if (this.owner && this.owner.fingerprint !== pin) return locked();
        this.owner = { handle, key, fingerprint: pin };
        await this.state.storage.put('owner', this.owner);
        return Response.json({ status: 'claimed' });
      });
    } catch {
      return locked();
    }
  }

  async webSocketMessage(socket: RelaySocket, raw: string | ArrayBuffer): Promise<void> {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (typeof raw !== 'string' || raw.length > MAX_RELAY_FRAME_BYTES) {
      this.close(socket, 1009, 'Frame too large');
      return;
    }
    const frameBytes = bytes(raw);
    if (frameBytes > MAX_RELAY_FRAME_BYTES) {
      this.close(socket, 1009, 'Frame too large');
      return;
    }
    const now = Date.now();
    if (now - peer.windowAt >= 1000) {
      peer.windowAt = now;
      peer.messages = 0;
      peer.bytes = 0;
    }
    peer.messages++;
    peer.bytes += frameBytes;
    if (peer.messages > (peer.host ? 480 : 120) || peer.bytes > (peer.host ? 1_048_576 : 262_144)) {
      this.close(socket, 1008, 'Rate limit');
      return;
    }
    socket.serializeAttachment(peer);
    try {
      const message: unknown = JSON.parse(raw);
      if (!isRecord(message)) {
        this.close(socket, 1008, 'Invalid frame');
        return;
      }
      if (this.handleControl(socket, peer, message)) return;
      if (message.type === 'host-auth') await this.authenticateHost(socket, peer, message, now);
      else this.route(socket, peer, message);
    } catch {
      this.close(socket, 1008, 'Locked');
    }
  }

  webSocketClose(socket: RelaySocket): void {
    this.disconnected(socket);
  }
  webSocketError(socket: RelaySocket): void {
    this.close(socket, 1011, 'Reconnect');
  }

  async alarm(): Promise<void> {
    this.alarmAt = null;
    for (const [socket, peer] of [...this.peers]) {
      if (peer.host || peer.authorized) continue;
      const deadline = peer.openedAt + 120_000;
      if (deadline <= Date.now()) this.close(socket, 1008, 'Pairing expired');
      else await this.scheduleExpiry(deadline);
    }
  }

  private async scheduleExpiry(deadline: number): Promise<void> {
    if (this.alarmAt !== null && this.alarmAt <= deadline) return;
    this.alarmAt = deadline;
    await this.state.storage.setAlarm(deadline);
  }

  private handleControl(
    socket: RelaySocket,
    peer: Peer,
    message: Record<string, unknown>,
  ): boolean {
    if (message.type === 'received') {
      this.acceptReceipt(socket, peer, message.deliveryId);
      return true;
    }
    if (!peer.host) return false;
    const target = this.findPeer(message.peerId);
    if (message.type === 'disconnect-peer') {
      if (target && target !== socket) this.close(target, 1008, 'Locked');
      return true;
    }
    if (message.type === 'authorize-peer') {
      const browser = target ? this.peers.get(target) : undefined;
      if (target && browser && !browser.host) {
        browser.authorized = true;
        target.serializeAttachment(browser);
      }
      return true;
    }
    return false;
  }

  private acceptReceipt(socket: RelaySocket, peer: Peer, deliveryId: unknown): void {
    if (
      typeof deliveryId !== 'number' ||
      !Number.isSafeInteger(deliveryId) ||
      deliveryId <= 0 ||
      deliveryId > peer.deliveryId
    ) {
      this.close(socket, 1008, 'Invalid receipt');
      return;
    }
    peer.outstanding = peer.outstanding.filter((item) => item.id > deliveryId);
    socket.serializeAttachment(peer);
  }

  private async authenticateHost(
    socket: RelaySocket,
    peer: Peer,
    message: Record<string, unknown>,
    now: number,
  ): Promise<void> {
    if (peer.host || !peer.challenge || now - peer.openedAt > 30_000) {
      this.close(socket, 1008, 'Locked');
      return;
    }
    const challenge = peer.challenge;
    peer.challenge = '';
    socket.serializeAttachment(peer);
    if (
      this.owner?.handle !== peer.handle ||
      typeof message.signature !== 'string' ||
      (await fingerprint(publicKey(message.publicKey))) !== this.owner.fingerprint ||
      !(await verifyIdentity(this.owner.key, hostProof(peer.handle, challenge), message.signature))
    ) {
      this.close(socket, 1008, 'Locked');
      return;
    }
    if (!this.peers.has(socket) || socket.readyState !== 1) return;
    const previous = this.host();
    peer.host = true;
    if (previous) this.close(previous, 1012, 'Laptop reconnected');
    socket.serializeAttachment(peer);
    socket.send(encode({ type: 'host-ready' }));
    for (const current of this.peers.values()) {
      if (!current.host) socket.send(encode({ type: 'peer-open', peerId: current.id }));
    }
  }

  private route(socket: RelaySocket, peer: Peer, message: Record<string, unknown>): void {
    if (message.type !== 'forward' || !isRecord(message.payload)) {
      this.close(socket, 1008, 'Invalid frame');
      return;
    }
    const expectedHello = peer.host ? 'host-hello' : 'client-hello';
    if (message.payload.type !== 'encrypted' && message.payload.type !== expectedHello) {
      this.close(socket, 1008, 'Invalid payload');
      return;
    }
    const target = peer.host ? this.findPeer(message.peerId) : this.host();
    if (!target || target === socket) return;
    const targetPeer = this.peers.get(target);
    if (!targetPeer || (peer.host && targetPeer.host)) {
      this.close(socket, 1008, 'Invalid target');
      return;
    }
    this.forward(socket, target, targetPeer, message.payload, peer.host ? undefined : peer.id);
  }

  private forward(
    source: RelaySocket,
    socket: RelaySocket,
    peer: Peer,
    payload: unknown,
    peerId: string | undefined,
  ): void {
    const deliveryId = peer.deliveryId + 1;
    const frame = encode({ type: 'forward', peerId, deliveryId, payload });
    const length = bytes(frame);
    if (length > MAX_RELAY_FRAME_BYTES) {
      this.close(source, 1009, 'Frame too large');
      return;
    }
    if (
      peer.outstanding.length >= 16 ||
      peer.outstanding.reduce((sum, item) => sum + item.bytes, length) > 262_144
    ) {
      // Browser bursts must never disconnect the laptop's shared relay socket.
      this.close(peer.host ? source : socket, 1013, 'Receiver too slow');
      return;
    }
    peer.deliveryId = deliveryId;
    peer.outstanding.push({ id: deliveryId, bytes: length });
    socket.serializeAttachment(peer);
    socket.send(frame);
  }

  private host(): RelaySocket | undefined {
    for (const [socket, peer] of this.peers)
      if (peer.host && socket.readyState === 1) return socket;
    return undefined;
  }

  private findPeer(id: unknown): RelaySocket | undefined {
    if (typeof id !== 'string') return undefined;
    for (const [socket, peer] of this.peers)
      if (peer.id === id && socket.readyState === 1) return socket;
    return undefined;
  }

  private close(socket: RelaySocket, code: number, reason: string): void {
    socket.close(code, reason);
    this.disconnected(socket);
  }

  private disconnected(socket: RelaySocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    if (peer.host) {
      for (const [browser, browserPeer] of [...this.peers])
        if (!browserPeer.host) this.close(browser, 1012, 'Laptop disconnected');
    } else this.host()?.send(encode({ type: 'peer-close', peerId: peer.id }));
  }
}
