const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { createDesktopApi } = require('./desktopApi.cjs');

function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function payloadBytes(payload) {
  if (!payload || typeof payload.data !== 'string') return 0;
  return Buffer.byteLength(payload.data, 'utf8');
}

const TERMINAL_MAX_QUEUED_BYTES = 2 * 1024 * 1024;
const TERMINAL_MAX_INPUT_BYTES = 32 * 1024;

function wrapTerminalPort(port) {
  const queued = [];
  let queuedBytes = 0;
  let droppedBytes = 0;
  let handler = null;

  function enqueue(payload) {
    const bytes = payloadBytes(payload);
    queued.push(payload);
    queuedBytes += bytes;
    while (queuedBytes > TERMINAL_MAX_QUEUED_BYTES && queued.length > 0) {
      let dropAt = queued.findIndex(
        (item) => item && (item.kind === 'data' || item.kind === 'replay'),
      );
      if (dropAt < 0) dropAt = 0;
      const [removed] = queued.splice(dropAt, 1);
      const removedBytes = payloadBytes(removed);
      queuedBytes = Math.max(0, queuedBytes - removedBytes);
      droppedBytes += removedBytes;
    }
  }

  function markTruncation() {
    if (droppedBytes <= 0) return;
    const first = queued.find((item) => item && (item.kind === 'data' || item.kind === 'replay'));
    if (first) {
      first.truncated = true;
      first.droppedBytes = (first.droppedBytes || 0) + droppedBytes;
    } else {
      queued.unshift({
        kind: 'data',
        data: '',
        sequence: 0,
        byteOffset: 0,
        truncated: true,
        droppedBytes,
      });
    }
    droppedBytes = 0;
  }

  port.addEventListener('message', (event) => {
    const payload = event.data;
    if (payload && (payload.kind === 'data' || payload.kind === 'replay')) {
      port.postMessage({
        type: 'ack',
        bytes: payloadBytes(payload),
        byteOffset: payload.byteOffset ?? payload.totalEmittedBytes ?? 0,
      });
    }
    if (handler) handler(payload);
    else enqueue(payload);
  });
  port.start();
  return {
    postInput(data) {
      if (typeof data !== 'string' || data.length === 0) return;
      if (Buffer.byteLength(data, 'utf8') > TERMINAL_MAX_INPUT_BYTES) return;
      try {
        port.postMessage({ type: 'input', data });
      } catch {
        // port already closed
      }
    },
    onEvent(next) {
      handler = next;
      markTruncation();
      if (queued.length > 0) {
        const pending = queued.splice(0);
        queuedBytes = 0;
        for (const payload of pending) next(payload);
      }
      return () => {
        if (handler === next) handler = null;
      };
    },
    close() {
      handler = null;
      queued.length = 0;
      queuedBytes = 0;
      droppedBytes = 0;
      try {
        port.close();
      } catch {
        // already closed
      }
    },
  };
}

function subscribeTerminalPort(id) {
  const { port1, port2 } = new MessageChannel();
  const channel = wrapTerminalPort(port2);
  ipcRenderer.postMessage('terminal-subscribe', { id }, [port1]);
  return channel;
}

contextBridge.exposeInMainWorld('droidex', {
  ...createDesktopApi({ invoke: (channel, payload) => ipcRenderer.invoke(channel, payload), on }),
  // Absolute path behind a dropped/pasted File ('' for clipboard snapshots).
  // File.path was removed in Electron 32; webUtils is the supported seam.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  terminalSubscribe: (id) => subscribeTerminalPort(id),
});
