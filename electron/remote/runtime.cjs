const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

// A private client of the real sidecar, not a replacement session store.
// All public DTOs are explicit projections; no credentials, asset URLs, provider
// config, raw tool arguments, native-browser requests, or arbitrary IPC escape.
const text = (value, max = 65536) => typeof value === 'string' ? value.slice(0, max) : '';
function sessionDTO(s) {
  return { appSessionId: text(s.appSessionId, 160), title: text(s.title, 300),
    modelId: text(s.modelId, 120), phase: text(s.phase, 40), streaming: s.streaming === true,
    updatedAt: Number(s.updatedAt) || 0 };
}
function transcriptDTO(e) {
  return { id: text(e.id, 200), appSessionId: text(e.appSessionId, 160),
    sourceSessionId: text(e.sourceSessionId, 160), role: text(e.role, 30),
    author: e.author === 'user' ? 'user' : 'assistant', ts: Number(e.ts) || 0,
    kind: text(e.kind, 40), text: text(e.text), toolName: text(e.toolName, 120),
    clipped: typeof e.text === 'string' && e.text.length > 65536 };
}
class RemoteRuntime extends EventEmitter {
  constructor(getBridgeInfo) {
    super(); this.getBridgeInfo = getBridgeInfo; this.pending = new Map();
    this.closed = true; this.connected = false; this.seq = 0; this.generation = 'remote-initial';
  }
  start() { this.closed = false; void this.connect(); }
  async connect() {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    try {
      const { port, token } = await this.getBridgeInfo();
      if (this.closed) return;
      const url = new URL(`ws://127.0.0.1:${port}`);
      url.search = new URLSearchParams({ token, bridgeProtocol: '4',
        resumeGeneration: `remote-connect-${randomUUID()}`, resumeSeq: '0' }).toString();
      const ws = new WebSocket(url); this.ws = ws;
      const opening = setTimeout(() => ws.close(), 10000);
      ws.addEventListener('open', () => {
        this.attempt = 0;
      });
      ws.addEventListener('message', ({ data }) => {
        try {
          const message = JSON.parse(String(data));
          if (message.type === 'bridge.snapshot') {
            clearTimeout(opening); this.connected = true;
            this.emit('event', { type: 'connection', connected: true });
          }
          this.receive(message);
        } catch { ws.close(); }
      });
      ws.addEventListener('error', () => ws.close());
      ws.addEventListener('close', () => {
        clearTimeout(opening);
        if (this.ws !== ws) return;
        this.connected = false; this.ws = null;
        for (const pending of this.pending.values()) pending.reject(new Error('Desktop disconnected. Command outcome may be unknown; do not resend automatically.'));
        this.pending.clear(); this.emit('event', { type: 'connection', connected: false });
        this.reconnect();
      });
    } catch { this.reconnect(); }
    finally { this.connecting = false; }
  }
  reconnect() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), Math.min(10000, 300 * 2 ** (this.attempt = (this.attempt || 0) + 1)) * (0.8 + Math.random() * 0.4));
    this.timer.unref?.();
  }
  receive(message) {
    if (message.type === 'bridge.snapshot' || message.type === 'bridge.reset') {
      this.generation = message.generation; this.seq = message.lastSeq;
      this.emit('event', { type: 'reset' }); return;
    }
    if (message.type !== 'events.batch') return;
    if (message.generation !== this.generation) {
      this.generation = message.generation; this.seq = message.firstSeq - 1;
      this.emit('event', { type: 'reset' });
    }
    for (const item of message.events) {
      if (item.seq <= this.seq) continue;
      if (item.seq !== this.seq + 1) this.emit('event', { type: 'reset' });
      this.seq = item.seq;
      const event = item.event;
      if (event.type === 'remote.reply') {
        const pending = this.pending.get(event.requestId);
        if (pending) { this.pending.delete(event.requestId); event.ok ? pending.resolve({ ...event.value, checkpoint: this.checkpoint?.() }) : pending.reject(new Error(text(event.error, 400))); }
      } else if (event.type === 'event.appended' && event.event.role === 'primary') {
        this.emit('event', { type: event.type, event: transcriptDTO(event.event) });
      } else if (event.type === 'session.updated' || event.type === 'session.created') {
        this.emit('event', { type: 'session.updated', session: sessionDTO(event.session) });
      } else if (event.type === 'session.closed') {
        this.emit('event', { type: 'session.closed', appSessionId: text(event.appSessionId, 160) });
      } else if (event.type === 'error' && event.appSessionId) {
        this.emit('event', { type: 'error', appSessionId: text(event.appSessionId, 160), message: 'The desktop reported a session error. Open DROIDEX for details.' });
      } else if (event.type === 'approval.requested' || event.type === 'question.requested') {
        const payload = event.request || event.question;
        if (payload?.appSessionId) this.emit('event', { type: 'notice', appSessionId: text(payload.appSessionId, 160), message: 'This turn needs approval or an answer in the desktop app.' });
      }
    }
  }
  request(op, args = {}) {
    if (!this.connected || this.ws?.readyState !== 1) return Promise.reject(new Error('Desktop is disconnected.'));
    if (this.pending.size >= 32) return Promise.reject(new Error('Desktop is busy.'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Desktop response timed out. A dispatched command may still be running.')); }, 15000);
      const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
      this.pending.set(requestId, { resolve: settle(resolve), reject: settle(reject) });
      try { this.ws.send(JSON.stringify({ type: 'remote.request', requestId, op, ...args })); }
      catch { this.pending.delete(requestId); clearTimeout(timer); reject(new Error('Desktop disconnected.')); }
    });
  }
  async sessions() {
    const result = await this.request('list');
    return { epoch: result.epoch, sessions: result.sessions.slice(0, 500).map(sessionDTO), moreSessions: result.sessions.length > 500, ...result.checkpoint };
  }
  async history(sessionId, cursor) {
    const page = await this.request('history', { sessionId, cursor });
    return { appSessionId: sessionId, transcripts: page.transcripts.filter((event) => event.role === 'primary').map(transcriptDTO), olderCursor: page.olderCursor || null, ...page.checkpoint };
  }
  close() {
    this.closed = true; clearTimeout(this.timer); this.ws?.close(); this.connected = false;
    for (const pending of this.pending.values()) pending.reject(new Error('Remote is disabled.'));
    this.pending.clear();
  }
}
module.exports = { RemoteRuntime, sessionDTO, transcriptDTO };
