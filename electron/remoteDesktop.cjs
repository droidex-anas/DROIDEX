const { EventEmitter } = require('node:events');
const { createDesktopApi } = require('./desktopApi.cjs');

// Stands in for a renderer's webContents when a paired Remote browser calls a
// desktop handler: it has an id for per-sender state, receives `send`, and is
// destroyed when the browser disconnects.
class RemoteSender extends EventEmitter {
  constructor(peerId) {
    super();
    this.id = `remote:${peerId}`;
    this.destroyed = false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, payload) {
    if (!this.destroyed) this.emit(`ipc:${channel}`, payload);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed');
    this.removeAllListeners();
  }
}

function isRemoteSender(sender) {
  return sender instanceof RemoteSender;
}

// Each paired browser gets the preload's method table bound to its own sender,
// so a Remote call runs exactly the code the laptop's window would.
function createRemoteDesktop({ desktopIpc, subscribeTerminal, MessageChannelMain }) {
  const peers = new Map();

  function peer(peerId) {
    const found = peers.get(peerId);
    if (!found) throw new Error('This Remote browser is no longer connected');
    return found;
  }

  function open(peerId) {
    close(peerId);
    const sender = new RemoteSender(peerId);
    const api = createDesktopApi({
      invoke: async (channel, payload) => desktopIpc.invoke(channel, payload, sender),
      on: (channel, handler) => {
        sender.on(`ipc:${channel}`, handler);
        return () => sender.off(`ipc:${channel}`, handler);
      },
    });
    peers.set(peerId, { sender, api });
  }

  function close(peerId) {
    peers.get(peerId)?.sender.destroy();
    peers.delete(peerId);
  }

  return {
    open,
    close,
    call(peerId, method, args) {
      return peer(peerId).api[method](...args);
    },
    listen(peerId, method, handler) {
      return peer(peerId).api[method](handler);
    },
    openTerminal(peerId, terminalId, onMessage) {
      const { sender } = peer(peerId);
      const { port1, port2 } = new MessageChannelMain();
      port2.on('message', (event) => onMessage(event.data));
      port2.start();
      try {
        subscribeTerminal(sender, terminalId, port1);
      } catch {
        // The registry already told the port why, and closed it.
      }
      return {
        post: (message) => port2.postMessage(message),
        close: () => port2.close(),
      };
    },
    broadcast(channel, payload, exceptSender) {
      for (const { sender } of peers.values()) {
        if (sender !== exceptSender) sender.send(channel, payload);
      }
    },
  };
}

module.exports = { createRemoteDesktop, isRemoteSender };
