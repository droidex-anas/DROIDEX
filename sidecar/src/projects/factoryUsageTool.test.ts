import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { factoryUsageTool } from './factoryUsageTool.js';

const windowEnd = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

test('factory_usage reads each account with its own login and says what follows Standard', async (t) => {
  const altToken = token(60 * 60);
  await signIn(t, 'DROIDEX_ALT_HOME', altToken, 'org-alt');
  await signIn(t, 'DROIDEX_ALT2_HOME', token(-60), 'org-alt2');
  // Factory answers a login token only for the organization it names.
  t.mock.method(globalThis, 'fetch', (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const authorization = headers.get('authorization');
    if (authorization === 'Bearer main-key')
      return Promise.resolve(
        Response.json({
          usesTokenRateLimitsBilling: true,
          overagePreference: 'extraUsage',
          extraUsageAllowed: true,
          extraUsageBalanceCents: 0,
          limits: { standard: { fiveHour: { usedPercent: 15, windowEnd } } },
        }),
      );
    if (authorization === `Bearer ${altToken}` && headers.get('x-factory-org-id') === 'org-alt')
      return Promise.resolve(
        Response.json({
          usesTokenRateLimitsBilling: true,
          overagePreference: 'droidCore',
          limits: {
            standard: { weekly: { usedPercent: 100, windowEnd } },
            core: { weekly: { usedPercent: 22, windowEnd } },
          },
        }),
      );
    return Promise.resolve(new Response(null, { status: 401 }));
  });

  const result = await factoryUsageTool(() => 'main-key').handler({});
  assert.ok(typeof result === 'string');
  const usage: { accounts: Record<string, unknown>[] } = JSON.parse(result);
  const [main, alt, alt2] = usage.accounts;
  assert.deepEqual(
    usage.accounts.map((account) => account.profile),
    ['main', 'alt', 'alt2'],
  );
  // An extra-usage preference with nothing to spend refuses work, as Droid does.
  assert.match(String(main?.whenStandardRunsOut), /refused until Standard resets/);
  assert.match(String(alt?.whenStandardRunsOut), /Droid Core model/);
  assert.deepEqual(alt?.windows, [
    { pool: 'Standard', window: 'weekly', usedPercent: 100, resetsAt: windowEnd },
    { pool: 'Droid Core', window: 'weekly', usedPercent: 22, resetsAt: windowEnd },
  ]);
  // One account's stale login does not hide the others.
  assert.match(String(alt2?.unavailable), /expired/);
});

// A login sealed the way Droid seals one beside its key file.
async function signIn(
  t: TestContext,
  homeVariable: 'DROIDEX_ALT_HOME' | 'DROIDEX_ALT2_HOME',
  accessToken: string,
  organizationId: string,
) {
  const home = await mkdtemp(join(tmpdir(), 'droidex-usage-'));
  t.after(async () => {
    delete process.env[homeVariable];
    await rm(home, { recursive: true, force: true });
  });
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const login = JSON.stringify({
    access_token: accessToken,
    active_organization_id: organizationId,
  });
  const ciphertext = Buffer.concat([cipher.update(login), cipher.final()]);
  const sealed = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64'));
  await mkdir(join(home, '.factory'));
  await writeFile(join(home, '.factory', 'auth.v2.key'), key.toString('base64'));
  await writeFile(join(home, '.factory', 'auth.v2.file'), sealed.join(':'));
  process.env[homeVariable] = home;
}

function token(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
}
