const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Script } = require('node:vm');
const { createRemoteServer } = require('./server.cjs');
const { RemoteRuntime, sessionDTO, transcriptDTO } = require('./runtime.cjs');
const { assets } = require('./page.cjs');

// Supporting gateway checks only. This controlled runtime is deliberately NOT
// a real-session acceptance host; no test here claims provider or phone success.
async function setup(t) {
  const runtime = new EventEmitter(); runtime.connected = true;
  runtime.sessions = async () => ({ epoch: 'runtime-1', sessions: [{ appSessionId: 'session-1', title: 'Isolated test' }] });
  runtime.history = async () => ({ transcripts: [] });
  const calls = []; runtime.request = async (...args) => { calls.push(args); return { status: 'dispatched' }; };
  let decision;
  const gateway = await createRemoteServer(runtime, () => new Promise((resolve) => { decision = resolve; }));
  gateway.setOrigin('https://remote.example'); t.after(() => gateway.close());
  const request = (path, { payload, cookie, origin = 'https://remote.example', host = 'remote.example' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: gateway.port, path, method: payload ? 'POST' : 'GET', headers: { host, origin, 'sec-fetch-site': 'same-origin', ...(payload ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) } }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, raw, body: raw.startsWith('{') ? JSON.parse(raw) : null }); });
    }); req.on('error', reject); req.end(payload ? JSON.stringify(payload) : undefined);
  });
  async function pair() {
    const invite = new URL(gateway.pairingLink()).hash.split('=')[1];
    const result = await request('/api/pair', { payload: { invite, name: 'Test phone' } });
    const cookie = result.headers['set-cookie'][0].split(';')[0];
    await new Promise((resolve) => setImmediate(resolve));
    return { result, cookie, invite, approve: () => decision(true) };
  }
  return { gateway, runtime, request, pair, calls };
}
test('real HTTP gateway requires desktop approval and sets a protected device cookie', async (t) => {
  const { request, pair } = await setup(t);
  assert.equal((await request('/api/state')).status, 401);
  const pending = await pair();
  assert.equal(pending.result.status, 202);
  assert.match(pending.result.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  assert.match(pending.result.body.code, /^\d{6}$/);
  assert.equal(Object.keys(pending.result.body).includes('token'), false);
  assert.equal((await request('/api/state', { cookie: pending.cookie })).status, 401);
  pending.approve(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request('/api/state', { cookie: pending.cookie })).body.sessions[0].appSessionId, 'session-1');
  assert.equal((await request('/api/pair', { payload: { invite: pending.invite, name: 'Replay' } })).status, 403);
});
test('revocation terminates an outstanding feed and prevents further dispatch', async (t) => {
  const { request, pair, gateway, calls } = await setup(t);
  const device = await pair(); device.approve(); await new Promise((resolve) => setImmediate(resolve));
  const state = (await request('/api/state', { cookie: device.cookie })).body;
  const poll = request(`/api/events?stream=${state.stream}&after=${state.seq}`, { cookie: device.cookie });
  await new Promise((resolve) => setTimeout(resolve, 20));
  gateway.revoke(gateway.devices()[0].id);
  assert.equal((await poll).status, 401);
  const result = await request('/api/command', { cookie: device.cookie, payload: { op: 'send', text: 'hello', sessionId: 'session-1', epoch: 'runtime-1', commandId: 'command-1', expiresAt: Date.now() + 30000 } });
  assert.equal(result.status, 401); assert.equal(calls.length, 0);
});
test('host, origin, command and deadline boundaries fail closed', async (t) => {
  const { request, pair, calls } = await setup(t);
  assert.equal((await request('/', { host: 'attacker.example' })).status, 403);
  const device = await pair(); device.approve(); await new Promise((resolve) => setImmediate(resolve));
  const payload = { op: 'send', text: 'hello', sessionId: 'session-1', epoch: 'runtime-1', commandId: 'command-1', expiresAt: Date.now() + 30000 };
  assert.equal((await request('/api/command', { cookie: device.cookie, payload, origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/command', { cookie: device.cookie, payload: { ...payload, op: 'connect', apiKey: 'not-allowed' } })).status, 400);
  assert.equal((await request('/api/command', { cookie: device.cookie, payload: { ...payload, expiresAt: Date.now() - 1 } })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('/api/command', { cookie: device.cookie, payload })).status, 200);
  assert.equal(calls[0][0], 'send'); assert.equal(calls[0][1].apiKey, undefined);
});
test('snapshot cursor is captured at the reply, not after later events in the same batch', async () => {
  const runtime = new RemoteRuntime(async () => {}); let sent, cursor = 0;
  runtime.connected = true; runtime.ws = { readyState: 1, send: (value) => { sent = JSON.parse(value); }, close() {} };
  runtime.on('event', () => cursor++); runtime.checkpoint = () => ({ seq: cursor });
  runtime.generation = 'generation-1';
  const result = runtime.request('history', { sessionId: 'session-1' });
  const event = (id) => ({ type: 'event.appended', event: { id, appSessionId: 'session-1', sourceSessionId: 'session-1', role: 'primary', kind: 'text', text: id } });
  runtime.receive({ type: 'events.batch', generation: 'generation-1', firstSeq: 1, lastSeq: 3, events: [
    { seq: 1, event: event('before') }, { seq: 2, event: { type: 'remote.reply', requestId: sent.requestId, ok: true, value: { transcripts: [] } } }, { seq: 3, event: event('after') },
  ] });
  assert.equal((await result).checkpoint.seq, 1); assert.equal(cursor, 2); runtime.close();
});
test('public DTOs omit bridge metadata, provider configuration and token-bearing assets', () => {
  const input = { appSessionId: 's', title: 'title', token: 'secret', apiKey: 'secret', resumeId: 'secret', browserRefs: [{ url: 'http://127.0.0.1/?token=secret' }], toolArgs: { apiKey: 'secret' } };
  assert.equal(JSON.stringify(sessionDTO(input)).includes('secret'), false);
  assert.equal(JSON.stringify(transcriptDTO(input)).includes('secret'), false);
  new Script(assets['/app.js'][1]);
  assert.equal(assets['/app.js'][1].includes('localStorage'), false);
});
