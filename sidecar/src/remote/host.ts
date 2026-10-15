import { authenticateDevice, setupAuthenticator } from './authentication.js';
import { settingsSchema, importIdentity, validateUrls, loadHostState } from './hostState.js';
import { RelayConnection } from './relayConnection.js';
import {
  createHostHello,
  fingerprint,
  finishHostHello,
  isRecord,
  verifyTotp,
  type HostHandshake,
  type Identity,
  type SecureChannel,
} from '../../../packages/remote/src/index.js';
import {
  remoteCommand,
  type RemoteCommand,
  type RemoteMessage,
} from '../../../packages/remote/src/application.js';
import type {
  RemoteDevice,
  RemotePending,
  RemoteState,
} from '../../../packages/remote/src/desktop.js';
import { RemoteLocalBridge } from './localBridge.js';
import { createPushNotifications, validatePushSubscription } from './push.js';
import { readRemoteUsage } from './profileUsage.js';
import { publishProfile, readPublishedProfile, revokeProfile } from './profilePublication.js';

interface Peer {
  id: string;
  handshake: HostHandshake;
  channel?: SecureChannel;
  deviceId?: string;
  expiresAt: number;
  deadline: number;
  selectedSession?: string;
  queued: number;
  outgoing: number;
  usageAvailableAt: number;
  queue: Promise<void>;
}
interface Pending {
  view: RemotePending;
  peer: Peer;
  device?: RemoteDevice;
  rememberDevice?: boolean;
  command?: RemoteCommand;
}

export async function createRemoteHost(options: {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  bridgeInfo: () => Promise<{ port: number; token: string }>;
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
  const bridge = new RemoteLocalBridge({
    bridgeInfo: options.bridgeInfo,
    workspace: () => state.settings.workspace,
    publish: (message) => {
      broadcast(message);
      if (message.type === 'snapshot' && message.approvals.length) push.notify();
    },
  });
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
          outgoing: 0,
          usageAvailableAt: 0,
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
  async function send(peer: Peer, message: RemoteMessage): Promise<void> {
    if (!peer.channel || !active(peer)) return;
    if (message.type === 'snapshot')
      message = {
        ...message,
        pushPublicKey: state.devices.some((device) => device.id === peer.deviceId)
          ? state.pushIdentity?.publicKey
          : undefined,
      };
    if (++peer.outgoing > 16) {
      drop(peer);
      return;
    }
    try {
      forward(peer, await peer.channel.encrypt(message));
    } catch {
      drop(peer);
    } finally {
      peer.outgoing--;
    }
  }
  function broadcast(message: RemoteMessage): void {
    for (const peer of peers.values()) {
      if (!peer.deviceId || peer.expiresAt <= Date.now()) continue;
      if (
        (message.type === 'stream' || message.type === 'history') &&
        peer.selectedSession !== message.sessionId
      )
        continue;
      void send(peer, message);
    }
  }
  function drop(peer: Peer): void {
    relay.send({ type: 'disconnect-peer', peerId: peer.id });
    peers.delete(peer.id);
    for (const [id, item] of pending) if (item.peer === peer) pending.delete(id);
    changed();
  }
  function stop(): void {
    relay.stop();
    peers.clear();
    pending.clear();
    bridge.stop();
    options.keepAwake(false);
    status = 'off';
    changed();
  }
  async function receive(peer: Peer, value: unknown): Promise<void> {
    if (!active(peer)) return;
    if (!peer.channel) {
      peer.channel = await finishHostHello(state.settings.profile.username, peer.handshake, value);
      return;
    }
    const payload = await peer.channel.decrypt(value);
    if (!active(peer)) return;
    if (!peer.deviceId) {
      const run = authQueue.then(() => authenticate(peer, payload));
      authQueue = run.then(
        () => undefined,
        () => undefined,
      );
      await run;
      return;
    }
    if (peer.expiresAt <= Date.now()) {
      await send(peer, { type: 'locked' });
      drop(peer);
      return;
    }
    const operationId =
      isRecord(payload) &&
      typeof payload.operationId === 'string' &&
      payload.operationId.length <= 64
        ? payload.operationId
        : undefined;
    const reply = (ok: boolean, message: string) =>
      send(peer, { type: 'result', ok, message, operationId });
    try {
      if (
        isRecord(payload) &&
        (payload.type === 'push.subscribe' || payload.type === 'push.unsubscribe')
      ) {
        if (!state.devices.some((device) => device.id === peer.deviceId))
          throw new Error('Notifications need a trusted device');
        if (payload.type === 'push.subscribe')
          state.subscriptions[peer.deviceId] = validatePushSubscription(payload.subscription);
        else Reflect.deleteProperty(state.subscriptions, peer.deviceId);
        await persist();
        await reply(
          true,
          payload.type === 'push.subscribe' ? 'Notifications on' : 'Notifications off',
        );
        return;
      }
      const command = remoteCommand(payload);
      if (command.type === 'usage') {
        const now = Date.now();
        if (peer.usageAvailableAt > now)
          throw new Error('Wait 10 seconds before refreshing usage again');
        peer.usageAvailableAt = now + 10_000;
        await send(peer, { type: 'usage', snapshot: await readRemoteUsage(options.bridgeInfo) });
        return;
      }
      if (command.type === 'open') peer.selectedSession = command.sessionId;
      if (bridge.needsApproval(command)) {
        if (pending.size >= 20) throw new Error('Too many pending requests');
        if (
          command.type === 'approval' &&
          [...pending.values()].some(
            (item) =>
              item.command?.type === 'approval' && item.command.requestId === command.requestId,
          )
        )
          throw new Error('This action is already waiting on your laptop');
        const id = crypto.randomUUID();
        pending.set(id, {
          view: {
            id,
            kind: 'action',
            title: 'Remote action',
            detail: bridge.describe(command),
            expiresAt: Date.now() + 120_000,
          },
          peer,
          command,
        });
        changed();
        push.notify();
        await reply(true, 'Waiting for approval on your laptop');
      } else {
        bridge.execute(command);
        if (command.type !== 'list' && command.type !== 'open')
          await reply(true, 'Sent to your laptop');
      }
    } catch (cause) {
      await reply(false, cause instanceof Error ? cause.message : 'Action failed');
    }
  }
  async function authenticate(peer: Peer, value: unknown): Promise<void> {
    if (!peer.channel) return;
    const result = await authenticateDevice(state, peer.channel, value, () => active(peer));
    if (!active(peer)) return;
    await persist();
    if (!active(peer)) return;
    if (result.kind === 'locked') {
      await send(peer, { type: 'locked' });
      return;
    }
    if (result.kind === 'trusted') {
      if (state.devices.includes(result.device) && result.device.expiresAt > Date.now())
        await authorize(peer, result.device);
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
        kind: 'device',
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
    await send(peer, { type: 'pairing', deviceId: id });
  }
  async function authorize(peer: Peer, device: RemoteDevice): Promise<void> {
    peer.deviceId = device.id;
    peer.expiresAt = device.expiresAt;
    relay.send({ type: 'authorize-peer', peerId: peer.id });
    await send(peer, { type: 'authorized', expiresAt: device.expiresAt });
    const snapshot = bridge.snapshot();
    await send(
      peer,
      snapshot.type === 'snapshot'
        ? { ...snapshot, pushPublicKey: state.pushIdentity?.publicKey }
        : snapshot,
    );
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
        if (identity && next.profile.username !== state.settings.profile.username) {
          const currentUsername = state.settings.profile.username;
          if (!currentUsername || !state.settings.relayUrl) {
            throw new Error('Restore your Remote relay settings before changing username');
          }
          if (await readPublishedProfile(state.settings.relayUrl, currentUsername, identity)) {
            throw new Error('Unpublish your profile before changing username');
          }
        }
        const reconnect =
          next.enabled !== state.settings.enabled || next.relayUrl !== state.settings.relayUrl;
        if (reconnect) stop();
        state.settings = next;
        await persist();
        if (next.enabled) {
          options.keepAwake(next.keepAwake);
          if (reconnect) {
            bridge.start();
            relay.start();
          }
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
          await send(item.peer, { type: 'result', ok: false, message: 'Denied on your laptop' });
          if (item.device) drop(item.peer);
          return snapshot();
        }
        if (item.device) {
          const approvedDevice = item.device;
          state.devices = state.devices.filter(
            (device) => device.expiresAt > Date.now() && device.id !== approvedDevice.id,
          );
          if (item.rememberDevice) {
            if (state.devices.length >= 20)
              throw new Error('Revoke a device before pairing another');
            state.devices.push(item.device);
            await persist();
          }
          if (active(item.peer)) await authorize(item.peer, item.device);
        } else if (item.command) {
          if (!item.peer.deviceId || item.peer.expiresAt <= Date.now())
            throw new Error('Device access expired');
          bridge.execute(item.command);
          await send(item.peer, { type: 'result', ok: true, message: 'Approved on your laptop' });
        }
        changed();
        return snapshot();
      });
    },
    revoke(id: unknown) {
      return mutate(async () => {
        if (typeof id !== 'string') throw new Error('Invalid device');
        state.devices = state.devices.filter((device) => device.id !== id);
        Reflect.deleteProperty(state.subscriptions, id);
        for (const peer of peers.values()) if (peer.deviceId === id) drop(peer);
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
        bridge.start();
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
