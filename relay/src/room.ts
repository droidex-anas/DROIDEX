import {
  claimProof,
  decodeProfilePayload,
  fingerprint,
  hostProof,
  isRecord,
  MAX_PROFILE_PAYLOAD_LENGTH,
  MAX_RELAY_FRAME_BYTES,
  profileChallengeProof,
  profilePublishProof,
  profileRevokeProof,
  profileShareProof,
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

interface ProfileChallenge extends ClaimChallenge {
  clientNonce: string;
  used: boolean;
}

interface StoredProfile {
  payload: string;
  signature: string;
}

const locked = () => Response.json({ status: 'locked' }, { status: 403 });
const conflict = () => Response.json({ status: 'conflict' }, { status: 409 });
const missing = () => Response.json({ status: 'not-found' }, { status: 404 });
const encode = (message: unknown) => JSON.stringify(message);
const encoder = new TextEncoder();
const bytes = (message: string) => encoder.encode(message).byteLength;
const MAX_PROFILE_MUTATION_BYTES = MAX_PROFILE_PAYLOAD_LENGTH * 2 + 4096;
// Anyone can open a socket, so sockets that are neither the laptop nor an
// authorized browser share a small pool where a newcomer evicts the oldest.
const MAX_WAITING_SOCKETS = 16;

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

async function smallBody(request: Request, maxBytes = 4096): Promise<unknown> {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Request too large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maxBytes) {
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
  private profile: StoredProfile | undefined;
  private peers = new Map<RelaySocket, Peer>();
  private alarmAt: number | null = null;

  constructor(private state: ObjectState) {
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void state.blockConcurrencyWhile(async () => {
      [this.owner, this.profile, this.alarmAt] = await Promise.all([
        state.storage.get<Owner>('owner'),
        state.storage.get<StoredProfile>('profile'),
        state.storage.getAlarm(),
      ]);
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
      this.evictOldestWaiting();
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
      // Presence is already observable through the laptop's handshake; saying it
      // up front lets a browser show "offline" without waiting for a timeout.
      pair[1].send(
        encode({
          type: 'relay-ready',
          peerId: peer.id,
          challenge: peer.challenge,
          laptopOnline: this.host() !== undefined,
        }),
      );
      this.host()?.send(encode({ type: 'peer-open', peerId: peer.id }));
      const response: ResponseInit & { webSocket: RelaySocket } = {
        status: 101,
        webSocket: pair[0],
      };
      return new Response(null, response);
    }
    if (path[4] === 'profile' && request.method === 'GET') {
      return this.publicProfile(handle);
    }
    if (path[4] === 'profile' && (request.method === 'POST' || request.method === 'DELETE')) {
      try {
        const body = await smallBody(request, MAX_PROFILE_MUTATION_BYTES);
        return await this.state.blockConcurrencyWhile(() =>
          this.mutateProfile(request.method, handle, body),
        );
      } catch {
        return locked();
      }
    }
    if (request.method !== 'POST') return locked();
    if (path[4] === 'profile-challenge') {
      try {
        const body = await smallBody(request);
        if (
          !isRecord(body) ||
          typeof body.nonce !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(body.nonce) ||
          typeof body.signature !== 'string' ||
          this.owner?.handle !== handle ||
          !(await verifyIdentity(
            this.owner.key,
            profileChallengeProof(handle, body.nonce),
            body.signature,
          ))
        ) {
          return locked();
        }
        return await this.state.blockConcurrencyWhile(async () => {
          const challenges = (
            (await this.state.storage.get<ProfileChallenge[]>('profileChallenges')) ?? []
          ).filter((item) => item.expiresAt > Date.now());
          if (
            challenges.length >= 8 ||
            challenges.some((item) => item.clientNonce === body.nonce)
          ) {
            return locked();
          }
          const challenge = {
            nonce: randomNonce(),
            clientNonce: body.nonce,
            expiresAt: Date.now() + 60_000,
            used: false,
          };
          await this.state.storage.put('profileChallenges', [...challenges, challenge]);
          return Response.json({ challenge: challenge.nonce });
        });
      } catch {
        return locked();
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
        const owner = { handle, key, fingerprint: pin };
        await this.state.storage.put('owner', owner);
        this.owner = owner;
        return Response.json({ status: 'claimed' });
      });
    } catch {
      return locked();
    }
  }

  private publicProfile(handle: string): Response {
    if (this.owner?.handle !== handle || !this.profile) return missing();
    return Response.json({
      payload: this.profile.payload,
      publicKey: this.owner.key,
      signature: this.profile.signature,
    });
  }

  private async mutateProfile(method: string, handle: string, body: unknown): Promise<Response> {
    try {
      if (
        !isRecord(body) ||
        typeof body.challenge !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.challenge) ||
        typeof body.authorization !== 'string'
      ) {
        return locked();
      }
      const owner = this.owner;
      if (owner?.handle !== handle) return locked();
      const challenges =
        (await this.state.storage.get<ProfileChallenge[]>('profileChallenges')) ?? [];
      const validChallenge = challenges.some(
        (item) => !item.used && item.nonce === body.challenge && item.expiresAt > Date.now(),
      );
      await this.state.storage.put(
        'profileChallenges',
        challenges
          .filter((item) => item.expiresAt > Date.now())
          .map((item) => (item.nonce === body.challenge ? { ...item, used: true } : item)),
      );
      if (!validChallenge) return locked();

      if (method === 'DELETE') {
        if (
          typeof body.currentPayload !== 'string' ||
          body.currentPayload !== this.profile?.payload
        ) {
          return conflict();
        }
        if (
          !(await verifyIdentity(
            owner.key,
            profileRevokeProof(handle, body.challenge, body.currentPayload),
            body.authorization,
          ))
        ) {
          return locked();
        }
        await this.state.storage.delete('profile');
        this.profile = undefined;
        return Response.json({ status: 'revoked' });
      }

      const currentPayload = body.currentPayload;
      if (
        (currentPayload !== null && typeof currentPayload !== 'string') ||
        currentPayload !== (this.profile?.payload ?? null) ||
        typeof body.payload !== 'string' ||
        typeof body.signature !== 'string'
      ) {
        return conflict();
      }
      const profile = decodeProfilePayload(body.payload);
      if (profile?.username !== handle) return locked();
      const [validSnapshot, validMutation] = await Promise.all([
        verifyIdentity(owner.key, profileShareProof(handle, body.payload), body.signature),
        verifyIdentity(
          owner.key,
          profilePublishProof(handle, body.challenge, currentPayload, body.payload),
          body.authorization,
        ),
      ]);
      if (!validSnapshot || !validMutation) return locked();
      const nextProfile = { payload: body.payload, signature: body.signature };
      await this.state.storage.put('profile', nextProfile);
      this.profile = nextProfile;
      return this.publicProfile(handle);
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

  private evictOldestWaiting(): void {
    let oldest: [RelaySocket, Peer] | undefined;
    let waiting = 0;
    for (const entry of this.peers) {
      if (entry[1].host || entry[1].authorized) continue;
      waiting++;
      if (!oldest || entry[1].openedAt < oldest[1].openedAt) oldest = entry;
    }
    if (oldest && waiting >= MAX_WAITING_SOCKETS)
      this.close(oldest[0], 1013, 'Too many connections');
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
