import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer | undefined;
let url = '';
test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('no server');
  url = `http://127.0.0.1:${address.port}/tests/smoke/board/presenceProbe.tmp.html`;
});
test.afterAll(async () => {
  await server?.close();
});

test('presence commits', async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('page error:', message.text().slice(0, 200));
  });
  await page.goto(url);
  await expect(page.locator('#board')).toBeAttached();
  const result = await page.evaluate(() => {
    const probe = (window as unknown as { probe: { dispatch: (a: unknown) => void; counts: () => { commits: number; renders: number; commitMs: number } } }).probe;
    let seq = 0;
    const session = (appSessionId: string) => ({
      appSessionId, providerSessionId: `p-${appSessionId}`, provider: 'droid', sessionPurpose: 'chat', interactionMode: 'auto',
      role: 'primary', title: appSessionId, goal: appSessionId, cwd: '/w', autonomy: 'low', phase: 'executing', streaming: true,
      features: [], tokensIn: 0, tokensOut: 0, contextTokens: 0, createdAt: 1, updatedAt: 1,
    });
    const ev = (fields: Record<string, unknown>) => {
      seq += 1;
      return { id: `e${seq}`, appSessionId: 'chat', sourceSessionId: 'p', role: 'primary', ts: seq, kind: 'text', ...fields };
    };
    const append = (event: unknown) => probe.dispatch({ type: 'SESSION_TRANSCRIPT', event });
    const write = (toolUseId: string, designIds: string[], state: 'running' | 'completed') =>
      ev({ kind: state === 'running' ? 'tool_call' : 'tool_result', toolUseId, canvasActivity: { toolUseId, action: 'write', designIds, state, message: '' } });
    const phases: Record<string, unknown> = {};
    const mark = (name: string, before: { commits: number; renders: number; commitMs: number }) => {
      const now = probe.counts();
      phases[name] = { commits: now.commits - before.commits, renders: now.renders - before.renders, ms: +(now.commitMs - before.commitMs).toFixed(2) };
      return now;
    };
    let at = probe.counts();
    probe.dispatch({ type: 'SESSION_CREATED', clientRef: 'x', session: session('chat') });
    probe.dispatch({ type: 'SESSION_CREATED', clientRef: 'y', session: session('other') });
    append(ev({ author: 'user', sourceSessionId: 'user', text: 'Design it' }));
    at = mark('setup (chat goes live, prompt)', at);
    append(write('w1', ['a'], 'running'));
    at = mark('presence change: write starts on a', at);
    for (let token = 0; token < 1000; token += 1)
      append(ev({ text: `tok${token} `, textUpdate: { messageId: 'm1', kind: 'delta' } }));
    at = mark('1000 tokens on the board chat', at);
    for (let token = 0; token < 1000; token += 1)
      append(ev({ appSessionId: 'other', text: `tok${token} `, textUpdate: { messageId: 'o1', kind: 'delta' } }));
    at = mark('1000 tokens on another chat', at);
    for (let tool = 0; tool < 20; tool += 1) {
      append(ev({ kind: 'tool_call', toolName: 'Read', toolUseId: `r${tool}` }));
      append(ev({ kind: 'tool_result', toolUseId: `r${tool}`, text: 'ok' }));
    }
    at = mark('20 non-canvas tool calls on the board chat', at);
    append(write('w2', ['b'], 'running'));
    at = mark('presence change: second write starts on b', at);
    append(write('w1', ['a'], 'completed'));
    at = mark('presence change: write on a lands', at);
    return { phases, text: document.getElementById('board')?.textContent };
  });
  console.log(JSON.stringify(result, null, 1));
});
