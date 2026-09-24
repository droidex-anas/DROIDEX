import { createHash, timingSafeEqual } from 'node:crypto';

export const RELAY_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export function roomId(hostToken) {
  return createHash('sha256').update(`droidex-room-v1:${hostToken}`).digest('hex');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Routes opaque encrypted frames. It never opens a connection to a user's computer. */
export function createRelayHub({ maxRooms = 1000, maxConnections = 3000 } = {}) {
  const rooms = new Map();
  const connections = new Map();
  let heartbeat;
  let stopped = false;

  function send(socket, message) {
    if (socket.readyState !== 1) return false;
    const text = JSON.stringify(message);
    if (socket.bufferedAmount + Buffer.byteLength(text) > MAX_FRAME_BYTES * 2) {
      socket.terminate();
      return false;
    }
    socket.send(text);
    return true;
  }

  function attach(socket) {
    if (stopped || connections.size >= maxConnections) {
      socket.close(1013, 'relay capacity');
      return;
    }
    let membership;
    let alive = true;
    let availableBytes = MAX_FRAME_BYTES * 2;
    let availableMessages = 120;
    let lastRefill = Date.now();
    const joinDeadline = setTimeout(() => socket.close(1008, 'join timeout'), 10_000);
    joinDeadline.unref();

    socket.on('pong', () => { alive = true; });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(joinDeadline);
      connections.delete(socket);
      if (membership) {
        const room = rooms.get(membership.id);
        if (room?.host === socket) {
          rooms.delete(membership.id);
          room.client?.close(1012, 'host offline');
        } else if (room?.client === socket) {
          room.client = undefined;
          send(room.host, { type: 'peer', online: false });
        }
      }
      if (connections.size === 0 && heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    });
    socket.on('message', (raw, binary = false) => {
      const bytes = Buffer.byteLength(raw);
      const now = Date.now();
      const elapsed = Math.max(0, now - lastRefill) / 1000;
      availableBytes = Math.min(MAX_FRAME_BYTES * 2, availableBytes + elapsed * MAX_FRAME_BYTES);
      availableMessages = Math.min(120, availableMessages + elapsed * 60);
      lastRefill = now;
      availableBytes -= bytes;
      availableMessages -= 1;
      if (binary || bytes > MAX_FRAME_BYTES || availableBytes < 0 || availableMessages < 0) {
        socket.close(1008, 'frame limit');
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1008, 'invalid frame');
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        socket.close(1008, 'invalid frame');
        return;
      }
      if (!membership) {
        if (message.v !== RELAY_VERSION) {
          socket.close(1008, 'unsupported protocol');
          return;
        }
        if (message.role === 'host' && TOKEN.test(message.hostToken ?? '') && DIGEST.test(message.clientTokenHash ?? '')) {
          const id = roomId(message.hostToken);
          if (rooms.has(id) || rooms.size >= maxRooms) {
            socket.close(1013, 'room unavailable');
            return;
          }
          rooms.set(id, { host: socket, clientTokenHash: message.clientTokenHash });
          membership = { id, role: 'host' };
          send(socket, { type: 'joined', role: 'host', roomId: id });
        } else if (message.role === 'client' && DIGEST.test(message.roomId ?? '') && TOKEN.test(message.clientToken ?? '')) {
          const room = rooms.get(message.roomId);
          const matches = room && timingSafeEqual(Buffer.from(room.clientTokenHash, 'hex'), Buffer.from(tokenHash(message.clientToken), 'hex'));
          if (!matches || room.client) {
            socket.close(1008, 'room unavailable');
            return;
          }
          room.client = socket;
          membership = { id: message.roomId, role: 'client' };
          send(socket, { type: 'joined', role: 'client', roomId: message.roomId });
          send(room.host, { type: 'peer', online: true });
        } else {
          socket.close(1008, 'invalid join');
          return;
        }
        clearTimeout(joinDeadline);
        return;
      }
      if (message.type !== 'data' || typeof message.data !== 'string') {
        socket.close(1008, 'invalid envelope');
        return;
      }
      const room = rooms.get(membership.id);
      const peer = membership.role === 'host' ? room?.client : room?.host;
      if (peer) send(peer, { type: 'data', data: message.data });
      else send(socket, { type: 'peer', online: false });
    });
    connections.set(socket, () => {
      if (!alive) socket.terminate();
      else {
        alive = false;
        socket.ping();
      }
    });
    if (!heartbeat) {
      heartbeat = setInterval(() => {
        for (const check of connections.values()) check();
      }, 30_000);
      heartbeat.unref();
    }
  }

  return {
    attach,
    get roomCount() { return rooms.size; },
    close() {
      stopped = true;
      clearInterval(heartbeat);
      heartbeat = undefined;
      for (const socket of [...connections.keys()]) socket.terminate();
      rooms.clear();
    },
  };
}
