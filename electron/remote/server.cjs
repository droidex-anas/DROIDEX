const http = require('node:http');
const { randomBytes, randomUUID, randomInt, createHash } = require('node:crypto');
const { assets } = require('./page.cjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const COOKIE = '__Host-droidex_remote';
const fail = (status, message) => Object.assign(new Error(message), { status });

// The only cleartext hop is this process's loopback listener. A dedicated HTTPS
// tunnel terminates here, never at the local bridge. There is no LAN listener.
async function createRemoteServer(runtime, approve) {
  let origin = null, invite = null, stopped = false, seq = 0, bytes = 0;
  const stream = randomUUID(), devices = new Map(), pending = new Map();
  const log = [], polls = new Set();
  const state = () => ({ stream, seq, connected: runtime.connected });
  const json = (res, status, body) => {
    if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
  };
  function publish(event) {
    const entry = { seq: ++seq, event };
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (size > 512 * 1024) { log.length = 0; bytes = 0; }
    else {
      log.push({ entry, size }); bytes += size;
      while (log.length > 2048 || bytes > 4 * 1024 * 1024) bytes -= log.shift().size;
    }
    for (const poll of [...polls]) poll();
  }
  runtime.on('event', publish);
  runtime.checkpoint = () => ({ stream, seq });
  function authenticate(req) {
    const token = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || !/^[\w-]{43}$/.test(token)) throw fail(401, 'Pair this browser in the desktop app.');
    const key = hash(token), device = devices.get(key);
    if (!device || device.expires <= Date.now()) { devices.delete(key); throw fail(401, 'This device is not approved or has been revoked.'); }
    return { key, device };
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON is required.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 40 * 1024) throw fail(413, 'Request is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail(400, 'Invalid JSON.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    let authenticated;
    try {
      if (stopped || !origin) throw fail(503, 'Remote is not enabled.');
      const expected = new URL(origin);
      if (req.headers.host !== expected.host) throw fail(403, 'Unrecognized host.');
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw fail(403, 'Unrecognized origin.');
      const sameSite = req.headers['sec-fetch-site'];
      if (sameSite && !['same-origin', 'none'].includes(sameSite)) throw fail(403, 'Cross-site request refused.');
      if (req.method === 'POST' && req.headers.origin !== origin) throw fail(403, 'Same-origin requests only.');
      if (req.method === 'GET' && assets[url.pathname]) {
        const [mime, content] = assets[url.pathname];
        res.writeHead(200, { 'content-type': mime }); res.end(content); return;
      }
      if (url.pathname === '/api/pair' && req.method === 'POST') {
        const input = await body(req);
        if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) throw fail(400, 'Name this browser (1–60 characters).');
        if (!invite || invite.expires <= Date.now() || typeof input.invite !== 'string' || hash(input.invite) !== invite.hash) throw fail(403, 'Pairing link expired or already used. Create a new link in DROIDEX.');
        if (pending.size >= 4 || devices.size >= 8) throw fail(429, 'Device limit reached. Revoke a device in DROIDEX.');
        invite = null;
        const token = secret(), key = hash(token), code = String(randomInt(100000, 1000000));
        const record = { id: randomUUID(), name: input.name.replace(/[\x00-\x1f\x7f]/g, '').trim(), code, status: 'pending', expires: Date.now() + 120000 };
        pending.set(key, record);
        // A pending cookie confers no session access. The matching browser gets
        // its code before the native dialog opens. No credential enters JS.
        res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
        json(res, 202, { code, status: 'pending' });
        setImmediate(() => void Promise.resolve().then(() => approve({ id: record.id, name: record.name, code })).then((allowed) => {
          if (stopped || pending.get(key) !== record || record.expires <= Date.now()) return;
          record.status = allowed ? 'approved' : 'denied';
          if (allowed) devices.set(key, { id: record.id, name: record.name, expires: Date.now() + 86400000 });
        }).catch(() => { record.status = 'denied'; }));
        return;
      }
      if (url.pathname === '/api/pair-status' && req.method === 'GET') {
        const cookie = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        const record = cookie && pending.get(hash(cookie));
        if (!record || record.expires <= Date.now()) throw fail(401, 'Pairing expired. Create a new link in DROIDEX.');
        json(res, 200, { status: record.status }); return;
      }
      authenticated = authenticate(req);
      const stillApproved = () => !stopped && devices.get(authenticated.key) === authenticated.device && authenticated.device.expires > Date.now();
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const value = await runtime.sessions();
        if (!stillApproved()) throw fail(401, 'Device revoked.');
        json(res, 200, { ...state(), ...value }); return;
      }
      if (url.pathname === '/api/history' && req.method === 'GET') {
        const id = url.searchParams.get('session');
        if (!id || !/^[\w:.-]{1,160}$/.test(id)) throw fail(400, 'Invalid session.');
        const value = await runtime.history(id, url.searchParams.get('cursor') || undefined);
        if (!stillApproved()) throw fail(401, 'Device revoked.');
        json(res, 200, { ...state(), ...value }); return;
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after'));
        if (!Number.isSafeInteger(after) || after < 0) throw fail(400, 'Invalid cursor.');
        if (polls.size >= 16) throw fail(429, 'Too many open views.');
        let timer;
        const finish = (timeout = false) => {
          const reset = url.searchParams.get('stream') !== stream || after > seq || (after < seq && (!log.length || after < log[0].entry.seq - 1));
          if (stillApproved() && !reset && after === seq && !timeout) return;
          clearTimeout(timer); polls.delete(finish);
          if (!stillApproved()) return json(res, 401, { error: 'Device revoked or Remote disabled.' });
          const events = []; let size = 0;
          if (!reset) for (const item of log) {
            if (item.entry.seq <= after) continue;
            if (events.length && size + item.size > 256 * 1024) break;
            events.push(item.entry); size += item.size;
          }
          json(res, 200, { ...state(), seq: events.at(-1)?.seq ?? seq, reset, events });
        };
        polls.add(finish); timer = setTimeout(() => finish(true), 20000);
        res.on('close', () => { clearTimeout(timer); polls.delete(finish); }); finish(); return;
      }
      if (url.pathname === '/api/command' && req.method === 'POST') {
        const input = await body(req);
        if (!input || !['send', 'stop'].includes(input.op) || !/^[\w:.-]{1,160}$/.test(input.sessionId || '') || !/^[\w-]{1,80}$/.test(input.commandId || '') || typeof input.epoch !== 'string') throw fail(400, 'Invalid command.');
        if (input.op === 'send' && (typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > 32768)) throw fail(400, 'Prompt must contain 1–32768 bytes.');
        if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 60000) throw fail(400, 'Command expired. Nothing was sent.');
        if (!stillApproved()) throw fail(401, 'Device revoked.');
        const result = await runtime.request(input.op, {
          sessionId: input.sessionId, text: input.op === 'send' ? input.text : undefined,
          epoch: input.epoch, commandId: `${authenticated.device.id}:${input.commandId}`, expiresAt: input.expiresAt,
        });
        if (!stillApproved()) throw fail(401, 'Device revoked. A previously dispatched command may still be running.');
        json(res, 200, result); return;
      }
      throw fail(404, 'Not found.');
    } catch (error) { json(res, error.status || 503, { error: error.status ? error.message : 'Desktop request failed or timed out. Check the session before resending a command.' }); }
  });
  server.requestTimeout = 25000; server.headersTimeout = 10000; server.maxConnections = 40;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', () => {});
  const sweep = setInterval(() => {
    for (const [key, item] of pending) if (item.expires <= Date.now()) pending.delete(key);
    for (const [key, item] of devices) if (item.expires <= Date.now()) devices.delete(key);
    for (const poll of [...polls]) poll();
  }, 10000); sweep.unref();
  return {
    port: server.address().port,
    setOrigin(value) { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('An HTTPS origin is required.'); origin = parsed.origin; },
    pairingLink() { if (!origin || stopped) throw new Error('Remote is not enabled.'); const token = secret(); invite = { hash: hash(token), expires: Date.now() + 300000 }; return `${origin}/#invite=${token}`; },
    origin: () => origin,
    devices: () => [...devices.values()].map(({ id, name }) => ({ id, name })),
    revoke(id) { for (const [key, device] of devices) if (device.id === id) { devices.delete(key); pending.delete(key); } for (const poll of [...polls]) poll(); },
    close() { stopped = true; invite = null; devices.clear(); pending.clear(); clearInterval(sweep); runtime.off('event', publish); for (const poll of [...polls]) poll(); server.close(); server.closeAllConnections(); log.length = 0; },
  };
}
module.exports = { createRemoteServer };
