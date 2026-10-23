import { authenticateDevice, setupAuthenticator } from './authentication.js';
import { settingsSchema, importIdentity, validateUrls, loadHostState } from './hostState.js';
import { RelayConnection } from './relayConnection.js';
import {
  createHostHello,
  fingerprint,
  finishHostHello,
  HOST_SEND_LIMITS,
  isRecord,
  SendBudget,
  Tunnel,
  verifyTotp,
  type HostHandshake,
  type Identity,
  type SecureChannel,
} from '../../../packages/remote/src/index.js';
import {
  remoteRequest,
  type RemoteMessage,
  type RemoteRequest,
} from '../../../packages/remote/src/application.js';
import type {
  RemoteDevice,
  RemotePending,
  RemoteState,
} from '../../../packages/remote/src/desktop.js';
import { createPushNotifications, validatePushSubscription } from './push.js';
import { publishProfile, readPublishedProfile, revokeProfile } from './profilePublication.js';
import { PeerSession, type PeerSessionRequest, type RemoteDesktop } from './peerSession.js';

interface Peer {
  id: string;
  handshake: HostHandshake;
  channel?: SecureChannel;
  tunnel?: Tunnel;
  session?: PeerSession;
  deviceId?: string;
  expiresAt: number;
  deadline: number;
  queued: number;
  queue: Promise<void>;
}
interface Pending {
  view: RemotePending;
  peer: Peer;
  device: RemoteDevice;
  rememberDevice: boolean;
}

// A pasted image travels as a data URL inside one desktop call.
const MAX_BROWSER_PACKET_CHARS = 32 * 1024 * 1024;

export async function createRemoteHost(options: {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  bridgeInfo: () => Promise<{ port: number; token: string }>;
  desktop: RemoteDesktop;
  changed: (state: RemoteState) => void;
  keepAwake: (enabled: boolean) => void;
  defaults: { relayUrl: string; clientUrl: string };
}) {
  const state = await loadHostState(options.load, options.defaults);
  let identity: Identity | null = state.privateKey ? await importIdentity(state.privateKey) : null;
  let pin = identity ? await fingerprint(identity.publicKey) : '';
  let status: RemoteState['status'] = 'off';
  let error: string | undefined;
  let mutations = Promise.resolve();
  let authQueue = Promise.resolve();
  const peers = new Map<string, Peer>();
  const pending = new Map<string, Pending>();
  // One relay socket carries every browser, so they share its send rate.
  const budget = new SendBudget(HOST_SEND_LIMITS);
  const relay = new RelayConnection(
    () => {
      if (!identity) throw new Error('Set up your authenticator first');
      return { origin: state.settings.relayUrl, handle: state.settings.profile.username, identity };
    },
    {
      status: (next, message) => {
        status = next;
        error = message;
        changed();
      },
      open: async (id, isCurrent) => {
        if (!identity || peers.size >= 8) {
          relay.send({ type: 'disconnect-peer', peerId: id });
          return;
        }
        const handshake = await createHostHello(state.settings.profile.username, identity);
        if (!state.settings.enabled || !isCurrent()) return;
        const peer: Peer = {
          id,
          handshake,
          expiresAt: 0,
          deadline: Date.now() + 120_000,
          queue: Promise.resolve(),
          queued: 0,
        };
        peers.set(id, peer);
        forward(peer, handshake.hello);
      },
      payload: (id, value) => {
        const peer = peers.get(id);
        if (!peer) return;
        if (++peer.queued > 16) {
          drop(peer);
          return;
        }
        peer.queue = peer.queue
          .then(() => receive(peer, value))
          .catch(() => {
            drop(peer);
          })
          .finally(() => {
            peer.queued--;
          });
      },
      close: (id) => {
        const peer = peers.get(id);
        if (peer) drop(peer);
      },
      disconnected: () => {
        for (const peer of peers.values()) release(peer);
        peers.clear();
        pending.clear();
      },
    },
  );
  const push = createPushNotifications(
    () => state,
    persist,
    (message) => {
      error = message;
      changed();
    },
  );
  function snapshot(): RemoteState {
    const clientUrl = state.settings.clientUrl.replace(/\/$/, '');
    return {
      ...state.settings,
      status,
      ...(error ? { error } : {}),
      devices: state.devices.filter((device) => device.expiresAt > Date.now()),
      pending: [...pending.values()].map((item) => item.view),
      authenticatorReady: state.authenticatorReady,
      ...(pin && state.settings.profile.username
        ? { pairingUrl: `${clientUrl}/${state.settings.profile.username}#key=${pin}` }
        : {}),
    };
  }
  function changed(): void {
    options.changed(snapshot());
  }
  function persist(): Promise<void> {
    return options.save(JSON.stringify(state));
  }
  function profileCredentials(): { identity: Identity; relayUrl: string; username: string } {
    const username = state.settings.profile.username;
    if (!identity || !username) {
      throw new Error('Finish Remote setup before publishing your profile');
    }
    if (!state.settings.relayUrl) throw new Error('Configure the Remote relay before publishing');
    return { identity, relayUrl: state.settings.relayUrl, username };
  }
  function active(peer: Peer): boolean {
    return state.settings.enabled && peers.get(peer.id) === peer;
  }
  function forward(peer: Peer, payload: unknown): void {
    if (active(peer)) relay.send({ type: 'forward', peerId: peer.id, payload });
  }
  function send(peer: Peer, message: RemoteMessage): void {
    if (active(peer)) peer.tunnel?.send(message);
  }
  function release(peer: Peer): void {
    peer.session?.close();
    peer.tunnel?.close();
  }
  function drop(peer: Peer): void {
    release(peer);
    relay.send({ type: 'disconnect-peer', peerId: peer.id });
    peers.delete(peer.id);
    for (const [id, item] of pending) if (item.peer === peer) pending.delete(id);
    changed();
  }
  // Disconnects after the browser has been told why.
  async function dismiss(peer: Peer, message: RemoteMessage): Promise<void> {
    send(peer, message);
    await peer.tunnel?.flush();
    if (peers.get(peer.id) === peer) drop(peer);
  }
  function stop(): void {
    relay.stop();
    peers.clear();
    pending.clear();
    options.keepAwake(false);
    status = 'off';
    changed();
  }
  async function receive(peer: Peer, value: unknown): Promise<void> {
    if (!active(peer)) return;
    if (!peer.channel) {
      const channel = await finishHostHello(state.settings.profile.username, peer.handshake, value);
      peer.channel = channel;
      peer.tunnel = new Tunnel({
        write: async (frame) => {
          forward(peer, await channel.encrypt(frame));
        },
        deliver: (message) => {
          dispatch(peer, remoteRequest(message));
        },
        fail: () => {
          drop(peer);
        },
        drained: () => peer.session?.resume(),
        budget,
        maxReceiveChars: MAX_BROWSER_PACKET_CHARS,
      });
      return;
    }
    const frame = await peer.channel.decrypt(value);
    if (active(peer)) await peer.tunnel?.receive(frame);
  }
  function dispatch(peer: Peer, request: RemoteRequest): void {
    if (!peer.deviceId) {
      if (request.type !== 'auth') throw new Error('Authenticate before sending requests');
      const run = authQueue.then(() => authenticate(peer, request));
      authQueue = run.catch(() => {
        drop(peer);
      });
      return;
    }
    if (peer.expiresAt <= Date.now()) {
      void dismiss(peer, { type: 'locked' });
      return;
    }
    switch (request.type) {
      case 'auth':
        return;
      case 'ping':
        send(peer, { type: 'pong' });
        return;
      case 'push.subscribe':
      case 'push.unsubscribe':
        void updatePush(peer, request);
        return;
      default:
        peer.session?.handle(request satisfies PeerSessionRequest);
    }
  }
  async function updatePush(
    peer: Peer,
    request: Extract<RemoteRequest, { type: 'push.subscribe' | 'push.unsubscribe' }>,
  ): Promise<void> {
    const deviceId = peer.deviceId;
    try {
      if (!deviceId || !state.devices.some((device) => device.id === deviceId))
        throw new Error('Notifications need a trusted device');
      if (request.type === 'push.subscribe')
        state.subscriptions[deviceId] = validatePushSubscription(request.subscription);
      else Reflect.deleteProperty(state.subscriptions, deviceId);
      await persist();
      send(peer, { type: 'result', id: request.id, ok: true, value: null });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Notifications failed';
      send(peer, { type: 'result', id: request.id, ok: false, error: message });
    }
  }
  async function authenticate(peer: Peer, value: unknown): Promise<void> {
    if (!peer.channel) return;
    const result = await authenticateDevice(state, peer.channel, value, () => active(peer));
    if (!active(peer)) return;
    await persist();
    if (!active(peer)) return;
    if (result.kind === 'locked') {
      send(peer, { type: 'locked' });
      return;
    }
    if (result.kind === 'trusted') {
      if (state.devices.includes(result.device) && result.device.expiresAt > Date.now())
        authorize(peer, result.device);
      return;
    }
    if (pending.size >= 20) return;
    const { id, key, name } = result;
    const pendingId = crypto.randomUUID();
    const expiresAt =
      state.settings.trustDays === 0
        ? Date.now() + 12 * 60 * 60_000
        : Date.now() + state.settings.trustDays * 86_400_000;
    const proposed: RemoteDevice = {
      id,
      name,
      publicKey: key,
      expiresAt,
      lastSeenAt: Date.now(),
    };
    pending.set(pendingId, {
      view: {
        id: pendingId,
        title: `Approve ${proposed.name}?`,
        detail: `Device ${id.slice(0, 12)} · ${state.settings.trustDays === 0 ? 'this connection' : `${String(state.settings.trustDays)} days`}`,
        expiresAt: peer.deadline,
      },
      peer,
      device: proposed,
      rememberDevice: state.settings.trustDays > 0,
    });
    changed();
    push.notify();
    send(peer, { type: 'pairing', deviceId: id });
  }
  function authorize(peer: Peer, device: RemoteDevice): void {
    const tunnel = peer.tunnel;
    if (!tunnel) return;
    peer.deviceId = device.id;
    peer.expiresAt = device.expiresAt;
    relay.send({ type: 'authorize-peer', peerId: peer.id });
    peer.session = new PeerSession({
      peerId: peer.id,
      desktop: options.desktop,
      bridgeInfo: options.bridgeInfo,
      send: (message) => {
        send(peer, message);
      },
      queuedChars: () => tunnel.queuedChars,
    });
    const remembered = state.devices.some((item) => item.id === device.id);
    send(peer, {
      type: 'authorized',
      expiresAt: device.expiresAt,
      pushPublicKey: remembered ? (state.pushIdentity?.publicKey ?? null) : null,
    });
  }
  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const run = mutations.then(action);
    mutations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  const sweep = setInterval(() => {
    for (const [id, item] of pending)
      if (item.view.expiresAt <= Date.now()) {
        pending.delete(id);
        drop(item.peer);
      }
    for (const peer of peers.values())
      if ((peer.deviceId ? peer.expiresAt : peer.deadline) <= Date.now()) drop(peer);
  }, 10_000);
  sweep.unref();

  return {
    snapshot,
    notifyDevices() {
      push.notify();
    },
    getPublishedProfile() {
      const credentials = profileCredentials();
      return readPublishedProfile(credentials.relayUrl, credentials.username, credentials.identity);
    },
    publishPublicProfile(payload: unknown) {
      return mutate(async () => {
        const credentials = profileCredentials();
        return publishProfile(
          credentials.relayUrl,
          credentials.username,
          credentials.identity,
          payload,
        );
      });
    },
    revokePublicProfile(payload: unknown) {
      return mutate(async () => {
        const credentials = profileCredentials();
        await revokeProfile(
          credentials.relayUrl,
          credentials.username,
          credentials.identity,
          payload,
        );
      });
    },
    configure(patch: unknown) {
      return mutate(async () => {
        if (!isRecord(patch)) throw new Error('Invalid remote settings');
        const next = settingsSchema.parse({ ...state.settings, ...patch });
        validateUrls(next);
        if (next.enabled && (!next.profile.username || !state.authenticatorReady))
          throw new Error('Choose a username and finish authenticator setup first');
        if (state.authenticatorReady && next.profile.username !== state.settings.profile.username)
          throw new Error(
            'Your paired username is fixed. Turn remote off and reset pairing before changing it',
          );
        const publicationLocationChanged =
          next.profile.username !== state.settings.profile.username ||
          next.relayUrl !== state.settings.relayUrl;
        if (identity && publicationLocationChanged) {
          const currentUsername = state.settings.profile.username;
          if (!currentUsername || !state.settings.relayUrl) {
            throw new Error('Restore your Remote address before changing username or relay');
          }
          if (await readPublishedProfile(state.settings.relayUrl, currentUsername, identity)) {
            throw new Error('Unpublish your profile before changing username or relay');
          }
        }
        const reconnect =
          next.enabled !== state.settings.enabled || next.relayUrl !== state.settings.relayUrl;
        if (reconnect) stop();
        state.settings = next;
        await persist();
        if (next.enabled) {
          options.keepAwake(next.keepAwake);
          if (reconnect) relay.start();
        }
        changed();
        return snapshot();
      });
    },
    setup() {
      return mutate(async () => {
        const setup = await setupAuthenticator(state, persist);
        identity = setup.identity;
        pin = await fingerprint(identity.publicKey);
        changed();
        return {
          secret: setup.secret,
          uri: setup.uri,
        };
      });
    },
    confirm(code: unknown) {
      return mutate(async () => {
        if (
          typeof code !== 'string' ||
          !state.secret ||
          (await verifyTotp(state.secret, code)) === null
        )
          throw new Error('Enter the current six-digit authenticator code');
        state.authenticatorReady = true;
        await persist();
        changed();
        return snapshot();
      });
    },
    decide(id: unknown, approved: unknown) {
      return mutate(async () => {
        if (typeof id !== 'string' || typeof approved !== 'boolean')
          throw new Error('Invalid approval');
        const item = pending.get(id);
        pending.delete(id);
        changed();
        if (!item || item.view.expiresAt <= Date.now() || !active(item.peer))
          throw new Error('This request expired');
        if (!approved) {
          void dismiss(item.peer, { type: 'denied' });
          return snapshot();
        }
        const approvedDevice = item.device;
        state.devices = state.devices.filter(
          (device) => device.expiresAt > Date.now() && device.id !== approvedDevice.id,
        );
        if (item.rememberDevice) {
          if (state.devices.length >= 20) throw new Error('Revoke a device before pairing another');
          state.devices.push(approvedDevice);
          await persist();
        }
        if (active(item.peer)) authorize(item.peer, approvedDevice);
        changed();
        return snapshot();
      });
    },
    revoke(id: unknown) {
      return mutate(async () => {
        if (typeof id !== 'string') throw new Error('Invalid device');
        state.devices = state.devices.filter((device) => device.id !== id);
        Reflect.deleteProperty(state.subscriptions, id);
        for (const peer of peers.values())
          if (peer.deviceId === id) void dismiss(peer, { type: 'removed' });
        await persist();
        changed();
        return snapshot();
      });
    },
    reset() {
      return mutate(async () => {
        stop();
        state.settings.enabled = false;
        state.devices = [];
        state.subscriptions = {};
        state.secret = undefined;
        state.authenticatorReady = false;
        state.lastStep = -1;
        state.failures = 0;
        state.lockedUntil = 0;
        await persist();
        return snapshot();
      });
    },
    resume() {
      if (state.settings.enabled) {
        validateUrls(state.settings);
        options.keepAwake(state.settings.keepAwake);
        relay.start();
      }
    },
    close() {
      clearInterval(sweep);
      stop();
      return mutations;
    },
  };
}
