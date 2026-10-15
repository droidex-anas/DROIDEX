import { useEffect, useRef, useState } from 'react';
import {
  acceptHostHello,
  isRecord,
  MAX_RELAY_FRAME_BYTES,
  signIdentity,
  type SecureChannel,
} from '../../packages/remote/src/index';
import {
  type RemoteApproval,
  type RemoteCommand,
  type RemoteSession,
} from '../../packages/remote/src/application';
import type { RemoteUsageSnapshot } from '../../packages/remote/src/usage';
import { parseRemoteMessage } from './messages';
import { LAST_HANDLE_KEY, prepareDevice, writeDevice, type BrowserDevice } from './deviceStore';

const DEFAULT_RELAY_URL = 'wss://droidex-relay.mdanas7869292.workers.dev';

export type ConnectionStatus = 'connecting' | 'offline' | 'code' | 'pairing' | 'ready' | 'error';
interface RemoteState {
  status: ConnectionStatus;
  sessions: RemoteSession[];
  approvals: RemoteApproval[];
  streams: Record<string, string>;
  feedback: string;
  expiresAt: number;
  pushPublicKey: string | null;
  selectedSessionId: string | null;
  usage: RemoteUsageSnapshot | null;
}
interface Connection {
  socket: WebSocket;
  channel: SecureChannel | null;
  device: BrowserDevice;
  needsStreamRestore: boolean;
}
interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface PendingUsage {
  operationId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function relayUrl(handle: string): string {
  const configured: unknown = import.meta.env.VITE_REMOTE_RELAY_URL;
  const url = new URL(
    typeof configured === 'string' && configured.trim() ? configured : DEFAULT_RELAY_URL,
  );
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:'))
    throw new Error('Remote access requires a secure WebSocket relay.');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Invalid relay configuration.');
  url.pathname = `/v1/handles/${encodeURIComponent(handle)}/socket`;
  return url.href;
}

export function useRemote(handle: string, pin: string | null) {
  const [state, setState] = useState<RemoteState>({
    status: 'connecting',
    sessions: [],
    approvals: [],
    streams: {},
    feedback: '',
    expiresAt: 0,
    pushPublicKey: null,
    selectedSessionId: null,
    usage: null,
  });
  const active = useRef<Connection | null>(null);
  const selectedSessionId = useRef<string | null>(null);
  const pending = useRef(new Map<string, PendingCommand>());
  const pendingUsage = useRef<PendingUsage | null>(null);
  const reconnect = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!pin) return;
    let disposed = false;
    let generation = 0;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lastReceivedAt = Date.now();
    const update = (next: Partial<RemoteState>) => {
      if (!disposed) setState((current) => ({ ...current, ...next }));
    };
    const close = () => {
      generation++;
      clearTimeout(reconnectTimer);
      clearTimeout(handshakeTimer);
      clearInterval(heartbeat);
      const previous = active.current;
      active.current = null;
      previous?.socket.close();
      for (const command of pending.current.values()) {
        clearTimeout(command.timer);
        command.reject(new Error('Your laptop disconnected before confirming the request.'));
      }
      pending.current.clear();
      const usageRequest = pendingUsage.current;
      if (usageRequest) {
        clearTimeout(usageRequest.timer);
        pendingUsage.current = null;
        usageRequest.reject(new Error('Your laptop disconnected before returning usage.'));
      }
    };

    const connect = async () => {
      close();
      const currentGeneration = generation;
      update({ status: attempts ? 'offline' : 'connecting', feedback: '' });
      try {
        const device = await prepareDevice(handle, pin);
        if (disposed || currentGeneration !== generation) return;
        const socket = new WebSocket(relayUrl(handle));
        const connection: Connection = { socket, channel: null, device, needsStreamRestore: false };
        active.current = connection;
        const isCurrent = () =>
          !disposed && currentGeneration === generation && active.current === connection;
        let incoming: Promise<void> = Promise.resolve();
        let queuedBytes = 0;
        handshakeTimer = setTimeout(() => {
          if (isCurrent() && !connection.channel) update({ status: 'offline' });
        }, 10_000);
        socket.onmessage = (event) => {
          if (event.data === 'pong') return;
          if (typeof event.data === 'string' && event.data.length <= MAX_RELAY_FRAME_BYTES) {
            try {
              const delivery: unknown = JSON.parse(event.data);
              if (
                isRecord(delivery) &&
                delivery.type === 'forward' &&
                Number.isSafeInteger(delivery.deliveryId)
              ) {
                socket.send(JSON.stringify({ type: 'received', deliveryId: delivery.deliveryId }));
              }
            } catch {
              socket.close();
              return;
            }
          }
          const incomingBytes =
            typeof event.data === 'string' ? event.data.length : MAX_RELAY_FRAME_BYTES;
          queuedBytes += incomingBytes;
          if (queuedBytes > MAX_RELAY_FRAME_BYTES * 4) {
            update({
              status: 'error',
              feedback: 'The connection exceeded its safe input limit. Reconnect to continue.',
            });
            close();
            return;
          }
          incoming = incoming
            .then(async () => {
              if (!isCurrent()) return;
              if (typeof event.data !== 'string' || event.data.length > MAX_RELAY_FRAME_BYTES)
                throw new Error('Invalid relay message.');
              const message: unknown = JSON.parse(event.data);
              if (!isRecord(message)) throw new Error('Invalid relay message.');
              if (message.type === 'relay-ready') return;
              if (message.type === 'locked') {
                const usageRequest = pendingUsage.current;
                if (usageRequest) {
                  clearTimeout(usageRequest.timer);
                  pendingUsage.current = null;
                  usageRequest.reject(new Error('The relay rejected the usage request.'));
                }
                update({
                  status: 'error',
                  feedback: 'Unable to connect. Wait a moment and retry.',
                });
                return;
              }
              if (message.type !== 'forward') throw new Error('Invalid relay response.');
              if (!connection.channel) {
                const accepted = await acceptHostHello(handle, pin, message.payload);
                if (!isCurrent()) return;
                connection.channel = accepted.channel;
                socket.send(JSON.stringify({ type: 'forward', payload: accepted.clientHello }));
                clearTimeout(handshakeTimer);
                lastReceivedAt = Date.now();
                if (device.expiresAt > Date.now()) {
                  await authenticateConnection(connection);
                } else {
                  update({ status: 'code' });
                }
                return;
              }
              const decoded = parseRemoteMessage(await connection.channel.decrypt(message.payload));
              if (!isCurrent()) return;
              lastReceivedAt = Date.now();
              switch (decoded.type) {
                case 'authorized':
                  attempts = 0;
                  connection.device = { ...device, expiresAt: decoded.expiresAt };
                  await writeDevice(connection.device);
                  if (!isCurrent()) return;
                  connection.needsStreamRestore = true;
                  update({ status: 'ready', expiresAt: decoded.expiresAt, feedback: '' });
                  try {
                    localStorage.setItem(LAST_HANDLE_KEY, handle);
                  } catch {
                    update({
                      feedback:
                        'This browser cannot remember your username. Open your laptop’s remote address directly next time.',
                    });
                  }
                  await sendOn(connection, { type: 'list' });
                  clearInterval(heartbeat);
                  heartbeat = setInterval(() => {
                    if (!isCurrent()) return;
                    if (Date.now() - lastReceivedAt > 65_000) {
                      socket.close();
                      return;
                    }
                    void sendOn(connection, { type: 'list' }).catch(() => {
                      socket.close();
                    });
                  }, 30_000);
                  break;
                case 'locked':
                  selectedSessionId.current = null;
                  for (const command of pending.current.values()) {
                    clearTimeout(command.timer);
                    command.reject(new Error('Unlock this browser before sending a request.'));
                  }
                  pending.current.clear();
                  if (pendingUsage.current) {
                    const usageRequest = pendingUsage.current;
                    clearTimeout(usageRequest.timer);
                    pendingUsage.current = null;
                    usageRequest.reject(new Error('Unlock this browser before requesting usage.'));
                  }
                  connection.device = { ...device, expiresAt: 0 };
                  await writeDevice(connection.device);
                  if (isCurrent())
                    update({
                      status: 'code',
                      sessions: [],
                      approvals: [],
                      streams: {},
                      usage: null,
                      selectedSessionId: null,
                      feedback: 'Unable to unlock. Check your code or wait before trying again.',
                    });
                  break;
                case 'pairing':
                  update({ status: 'pairing', feedback: '' });
                  break;
                case 'usage': {
                  update({ usage: decoded.snapshot });
                  const usageRequest = pendingUsage.current;
                  if (usageRequest) {
                    clearTimeout(usageRequest.timer);
                    pendingUsage.current = null;
                    usageRequest.resolve();
                  }
                  break;
                }
                case 'snapshot': {
                  const liveIds = new Set(decoded.sessions.map((session) => session.id));
                  const removedSelection =
                    selectedSessionId.current !== null && !liveIds.has(selectedSessionId.current);
                  if (removedSelection) selectedSessionId.current = null;
                  setState((previous) => {
                    if (!isCurrent()) return previous;
                    const streams = Object.fromEntries(
                      Object.entries(previous.streams)
                        .filter(([id]) => liveIds.has(id))
                        .slice(-32),
                    );
                    return {
                      ...previous,
                      sessions: decoded.sessions,
                      approvals: decoded.approvals,
                      streams,
                      pushPublicKey: decoded.pushPublicKey ?? null,
                      selectedSessionId: selectedSessionId.current,
                      feedback: removedSelection
                        ? 'The selected task is no longer available.'
                        : previous.feedback,
                    };
                  });
                  if (connection.needsStreamRestore) {
                    connection.needsStreamRestore = false;
                    if (selectedSessionId.current)
                      await sendOn(connection, {
                        type: 'open',
                        sessionId: selectedSessionId.current,
                      });
                  }
                  break;
                }
                case 'stream':
                case 'history':
                  setState((previous) => {
                    if (!isCurrent()) return previous;
                    const text =
                      decoded.type === 'history'
                        ? decoded.text
                        : `${previous.streams[decoded.sessionId] ?? ''}${decoded.text}`;
                    return {
                      ...previous,
                      streams: { ...previous.streams, [decoded.sessionId]: text.slice(-48_000) },
                    };
                  });
                  break;
                case 'result':
                  if (decoded.operationId) {
                    const usageRequest = pendingUsage.current;
                    if (usageRequest?.operationId === decoded.operationId && !decoded.ok) {
                      clearTimeout(usageRequest.timer);
                      pendingUsage.current = null;
                      usageRequest.reject(new Error(decoded.message));
                    }
                    const command = pending.current.get(decoded.operationId);
                    if (command) {
                      clearTimeout(command.timer);
                      pending.current.delete(decoded.operationId);
                      if (decoded.ok) command.resolve();
                      else command.reject(new Error(decoded.message));
                    }
                  }
                  update({ feedback: decoded.message });
                  break;
              }
            })
            .catch((error: unknown) => {
              if (!isCurrent()) return;
              update({
                status: 'error',
                feedback: error instanceof Error ? error.message : 'The secure connection failed.',
              });
              close();
            })
            .finally(() => {
              queuedBytes -= incomingBytes;
            });
        };
        socket.onclose = () => {
          if (!isCurrent()) return;
          active.current = null;
          for (const command of pending.current.values()) {
            clearTimeout(command.timer);
            command.reject(new Error('Your laptop disconnected before confirming the request.'));
          }
          pending.current.clear();
          const usageRequest = pendingUsage.current;
          if (usageRequest) {
            clearTimeout(usageRequest.timer);
            pendingUsage.current = null;
            usageRequest.reject(new Error('Your laptop disconnected before returning usage.'));
          }
          clearInterval(heartbeat);
          update({ status: 'offline' });
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
          reconnectTimer = setTimeout(() => void connect(), delay);
        };
        socket.onerror = () => {
          socket.close();
        };
      } catch (error) {
        if (!disposed && currentGeneration === generation)
          update({
            status: 'error',
            feedback: error instanceof Error ? error.message : 'Unable to start remote access.',
          });
      }
    };
    reconnect.current = () => {
      attempts = 0;
      void connect();
    };
    const resume = () => {
      if (
        document.visibilityState === 'visible' &&
        active.current?.socket.readyState !== WebSocket.OPEN
      )
        void connect();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    void connect();
    return () => {
      disposed = true;
      close();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [handle, pin]);

  const authenticate = async (code: string) => {
    const connection = active.current;
    if (!connection?.channel) throw new Error('Wait for your laptop to connect, then retry.');
    setState((previous) => ({ ...previous, status: 'pairing', feedback: '' }));
    try {
      await authenticateConnection(connection, code);
    } catch (error) {
      setState((previous) => ({ ...previous, status: 'code' }));
      throw error;
    }
  };
  const send = async (command: RemoteCommand) => {
    const connection = active.current;
    if (state.status !== 'ready' || !connection?.channel)
      throw new Error('Reconnect to your laptop before sending a command.');
    if (command.type === 'usage') {
      if (pendingUsage.current) {
        await pendingUsage.current.promise;
        return;
      }
      let resolveRequest!: () => void;
      let rejectRequest!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const timer = setTimeout(() => {
        const request = pendingUsage.current;
        if (request?.promise !== promise) return;
        pendingUsage.current = null;
        request.reject(
          new Error(
            'Your laptop has not returned usage. Check its connection before trying again.',
          ),
        );
      }, 15_000);
      const request: PendingUsage = {
        operationId: crypto.randomUUID(),
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      };
      pendingUsage.current = request;
      try {
        await Promise.all([
          sendOn(connection, { ...command, operationId: request.operationId }),
          promise,
        ]);
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error('Unable to request usage.');
        if (pendingUsage.current === request) {
          clearTimeout(timer);
          pendingUsage.current = null;
          request.reject(error);
        }
        throw error;
      }
      return;
    }
    if (command.type === 'list' || command.type === 'open') {
      if (command.type === 'open') {
        selectedSessionId.current = command.sessionId;
        connection.needsStreamRestore = false;
        setState((previous) => ({ ...previous, selectedSessionId: command.sessionId }));
      }
      await sendOn(connection, command);
      return;
    }
    if (pending.current.size >= 16)
      throw new Error('Wait for your pending requests before sending another.');
    const operationId = crypto.randomUUID();
    await new Promise<void>((resolve, reject: (error: Error) => void) => {
      const timer = setTimeout(() => {
        pending.current.delete(operationId);
        reject(
          new Error(
            'Your laptop has not confirmed this request. Check its connection before trying again.',
          ),
        );
      }, 15_000);
      pending.current.set(operationId, { resolve, reject, timer });
      void sendOn(connection, { ...command, operationId }).catch((reason: unknown) => {
        clearTimeout(timer);
        pending.current.delete(operationId);
        reject(reason instanceof Error ? reason : new Error('Unable to send your request.'));
      });
    });
  };
  return {
    ...state,
    authenticate,
    send,
    retry: () => {
      reconnect.current?.();
    },
    closeSession: () => {
      selectedSessionId.current = null;
      setState((previous) => ({ ...previous, selectedSessionId: null }));
    },
  };
}

async function sendOn(connection: Connection, message: unknown) {
  const channel = connection.channel;
  if (!channel || connection.socket.readyState !== WebSocket.OPEN)
    throw new Error('Your laptop is disconnected.');
  const payload = await channel.encrypt(message);
  if (!socketIsOpen(connection.socket)) throw new Error('Your laptop is disconnected.');
  connection.socket.send(JSON.stringify({ type: 'forward', payload }));
}

function socketIsOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

async function authenticateConnection(connection: Connection, code?: string) {
  if (!connection.channel) throw new Error('The secure connection is not ready.');
  const signature = await signIdentity(
    connection.device.identity.privateKey,
    connection.channel.challenge,
  );
  let deviceName = 'Web browser';
  if (/iPhone|iPad/.test(navigator.userAgent)) deviceName = 'Safari on iPhone / iPad';
  else if (navigator.userAgent.includes('Android')) deviceName = 'Android browser';
  await sendOn(connection, {
    type: 'auth',
    publicKey: connection.device.identity.publicKey,
    signature,
    deviceName,
    ...(code ? { code } : {}),
  });
}
