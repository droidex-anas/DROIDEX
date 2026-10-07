import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import { hasCliLogin, resolveDroidPath } from '../../sidecar/src/Environment.ts';
import { BRIDGE_PROTOCOL_VERSION } from '../../src/types/bridge.ts';

type SmokeResult = { appSessionId: string; assistantText: string };
type BridgeInfo = { port: number; token: string };
type SidecarReadyProof = { port: number; pid: number; tokenHash: string };
const PRELOAD_ONLY_BOOTSTRAP_DOCUMENT =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>E1 bootstrap</body></html>';
function createPreloadOnlyBootstrapUrl(): string {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(PRELOAD_ONLY_BOOTSTRAP_DOCUMENT)}`;
  assertPreloadOnlyBootstrapUrl(url);
  return url;
}
function assertPreloadOnlyBootstrapUrl(url: string): void {
  assert.equal(new URL(url).protocol, 'data:', 'E1 bootstrap must use a data URL.');
  const documentSource = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  assert.equal(
    documentSource,
    PRELOAD_ONLY_BOOTSTRAP_DOCUMENT,
    'E1 bootstrap document must stay preload-only.',
  );
  assert.equal(/<script\b/i.test(documentSource), false, 'E1 bootstrap must not execute scripts.');
  assert.equal(
    /<(?:iframe|img|link|audio|video|object|embed|source)\b/i.test(documentSource),
    false,
    'E1 bootstrap must not load subresources.',
  );
}
async function assertPreloadOnlyBootstrap(page: Page, url: string): Promise<void> {
  const state = await page.evaluate(() => ({
    url: window.location.href,
    scriptCount: document.scripts.length,
    hasReactRoot: document.getElementById('root') !== null,
    hasPreload: typeof window.droidControl?.bridgeInfo === 'function',
  }));
  assert.deepEqual(state, { url, scriptCount: 0, hasReactRoot: false, hasPreload: true });
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}
async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('E1 could not allocate a loopback bridge port.');
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
function writeIsolatedSidecarEntry(home: string, sidecar: string): string {
  const entry = path.join(home, 'e1-sidecar-entry.mjs');
  writeFileSync(
    entry,
    [
      "import { createHash } from 'node:crypto';",
      "import { renameSync, unlinkSync, writeFileSync } from 'node:fs';",
      'const proofPath = process.env.SIDECAR_READY_PROOF;',
      'const port = Number(process.env.BRIDGE_PORT);',
      "const token = process.env.BRIDGE_TOKEN ?? '';",
      'const readyLine = `SIDECAR_READY ${port}\\n`;',
      'let proofWritten = false;',
      'function writeReadyProof() {',
      '  if (proofWritten || !proofPath || !token || !Number.isSafeInteger(port)) return;',
      '  const temporaryProof = `${proofPath}.${process.pid}.tmp`;',
      '  try {',
      '    writeFileSync(',
      '      temporaryProof,',
      "      JSON.stringify({ port, pid: process.pid, tokenHash: createHash('sha256').update(token).digest('hex') }) + '\\n',",
      '      { mode: 0o600 },',
      '    );',
      '    renameSync(temporaryProof, proofPath);',
      '    proofWritten = true;',
      '  } catch {',
      '    try { unlinkSync(temporaryProof); } catch {}',
      '  }',
      '}',
      'const originalWrite = process.stdout.write.bind(process.stdout);',
      'process.stdout.write = function write(chunk, ...args) {',
      '  if (!proofWritten && String(chunk) === readyLine) writeReadyProof();',
      '  return originalWrite(chunk, ...args);',
      '};',
      "process.env.BRIDGE_ALLOW_LOCAL_NO_TOKEN = '0';",
      `await import(${JSON.stringify(pathToFileURL(sidecar).href)});`,
      '',
    ].join('\n'),
  );
  return entry;
}
function waitForSidecarReadyProof(proofPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | undefined;
    const settle = (proof?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher?.close();
      if (error) reject(error);
      else resolve(proof!);
    };
    const readProof = () => {
      if (!existsSync(proofPath)) return;
      try {
        settle(readFileSync(proofPath, 'utf8'));
      } catch {
        // The wrapper writes then atomically renames; wait for its next filesystem event.
      }
    };
    const timeout = setTimeout(
      () => settle(undefined, new Error('E1 sidecar readiness proof did not appear.')),
      10_000,
    );
    try {
      watcher = watch(path.dirname(proofPath), readProof);
    } catch {
      settle(undefined, new Error('E1 could not watch for the sidecar readiness proof.'));
      return;
    }
    readProof();
  });
}

function parseSidecarReadyProof(proofText: string): SidecarReadyProof {
  let value: unknown;
  try {
    value = JSON.parse(proofText);
  } catch {
    throw new Error('E1 sidecar readiness proof is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('E1 sidecar readiness proof has an invalid shape.');
  const proof = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(proof.port) ||
    proof.port <= 0 ||
    proof.port > 65_535 ||
    !Number.isSafeInteger(proof.pid) ||
    proof.pid <= 1 ||
    proof.pid > 0x7fffffff ||
    typeof proof.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(proof.tokenHash)
  )
    throw new Error('E1 sidecar readiness proof has invalid values.');
  return { port: proof.port, pid: proof.pid, tokenHash: proof.tokenHash };
}

async function verifySidecarReadyProof(proofPath: string, bridge: BridgeInfo): Promise<void> {
  const proofText = await waitForSidecarReadyProof(proofPath);
  if ((statSync(proofPath).mode & 0o777) !== 0o600)
    throw new Error('E1 sidecar readiness proof must be mode 0600.');
  if (proofText.includes(bridge.token))
    throw new Error('E1 sidecar readiness proof unexpectedly contains a raw token.');
  const proof = parseSidecarReadyProof(proofText);
  if (proof.port !== bridge.port)
    throw new Error('E1 sidecar readiness proof did not report the selected port.');
  try {
    process.kill(proof.pid, 0);
  } catch {
    throw new Error('E1 sidecar readiness proof did not report a live process.');
  }
  const expectedHash = createHash('sha256').update(bridge.token).digest();
  const proofHash = Buffer.from(proof.tokenHash, 'hex');
  if (proofHash.length !== expectedHash.length || !timingSafeEqual(proofHash, expectedHash))
    throw new Error('E1 sidecar readiness proof token hash did not match bridge ownership.');
}

async function verifyOwnedBridge(page: Page, bridge: BridgeInfo): Promise<void> {
  const info = { ...bridge, bridgeProtocol: BRIDGE_PROTOCOL_VERSION };
  await page.evaluate(async (info) => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${info.port}`);
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        try {
          socket.close();
        } catch {
          // Closing an already failed socket must preserve the probe's result.
        }
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(
        () => settle(new Error('E1 unauthenticated bridge probe timed out.')),
        10_000,
      );
      socket.onerror = () => settle(new Error('E1 unauthenticated bridge probe failed.'));
      socket.onclose = (event) => {
        if (event.code !== 1008) {
          settle(new Error('E1 bridge accepted an unauthenticated WebSocket.'));
          return;
        }
        settle();
      };
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${info.port}?token=${encodeURIComponent(info.token)}&bridgeProtocol=${info.bridgeProtocol}`,
      );
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        try {
          socket.close();
        } catch {
          // Closing an already failed socket must preserve the probe's result.
        }
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(
        () => settle(new Error('E1 authenticated environment probe timed out.')),
        20_000,
      );
      socket.onopen = () => {
        try {
          socket.send(JSON.stringify({ type: 'env.detect' }));
        } catch {
          settle(new Error('E1 authenticated bridge probe could not send env.detect.'));
        }
      };
      socket.onerror = () => settle(new Error('E1 authenticated bridge probe failed.'));
      socket.onclose = () => settle(new Error('E1 bridge closed before env.report.'));
      socket.onmessage = ({ data }) => {
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          settle(new Error('E1 environment probe received invalid JSON.'));
          return;
        }
        if (!event || typeof event !== 'object' || Array.isArray(event)) return;
        const wireMessage = event as Record<string, unknown>;
        const entries =
          wireMessage.type === 'events.batch' && Array.isArray(wireMessage.events)
            ? wireMessage.events
            : [{ event: wireMessage }];
        const value = entries
          .map((entry) =>
            entry && typeof entry === 'object' && 'event' in entry
              ? (entry.event as Record<string, unknown>)
              : null,
          )
          .find((entry) => entry?.type === 'env.report');
        if (!value) return;
        const report = value.report;
        if (
          !report ||
          typeof report !== 'object' ||
          Array.isArray(report) ||
          !('cli' in report) ||
          !report.cli ||
          typeof report.cli !== 'object' ||
          Array.isArray(report.cli) ||
          report.cli.present !== true
        ) {
          settle(new Error('E1 env.report did not confirm CLI readiness.'));
          return;
        }
        settle();
      };
    });
  }, info);
}

async function runRoundTrip(page: Page): Promise<SmokeResult> {
  return page.evaluate(async (bridgeProtocol) => {
    const { port, token } = await window.droidControl!.bridgeInfo();
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}&bridgeProtocol=${bridgeProtocol}`,
    );
    return new Promise<SmokeResult>((resolve, reject) => {
      const clientRef = `e1-${Date.now()}`;
      let appSessionId = '';
      let providerSessionId = '';
      let assistantText = '';
      let settled = false;
      let closeSent = false;
      let lastEventType = 'none';
      let streaming = false;
      let turnStarted = false;
      let textEvents = 0;
      const sendSessionClose = () => {
        if (!appSessionId || closeSent || ws.readyState !== WebSocket.OPEN) return;
        closeSent = true;
        try {
          ws.send(JSON.stringify({ type: 'session.close', appSessionId }));
        } catch {
          // Best-effort session cleanup must not replace the original failure.
        }
      };
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) sendSessionClose();
        try {
          ws.close();
        } catch {
          // Closing an already failed socket must preserve the round-trip result.
        }
        if (error) reject(error);
        else resolve({ appSessionId, assistantText });
      };
      const timer = window.setTimeout(
        () =>
          settle(
            new Error(
              `E1 timed out (created=${Boolean(appSessionId)}, assistantChars=${assistantText.length}, streaming=${streaming}, closeSent=${closeSent}, lastEvent=${lastEventType})`,
            ),
          ),
        120_000,
      );
      ws.onclose = () => settle(new Error('E1 bridge closed before the round trip completed'));
      ws.onopen = () => {
        if (settled) return;
        try {
          ws.send(
            JSON.stringify({
              type: 'session.create',
              clientRef,
              title: 'E1 authenticated smoke',
              goal: 'Reply with exactly E1_OK.',
              sessionPurpose: 'chat',
              interactionMode: 'auto',
              autonomy: 'off',
            }),
          );
        } catch {
          settle(new Error('E1 bridge WebSocket failed'));
        }
      };
      ws.onerror = () => settle(new Error('E1 bridge WebSocket failed'));
      ws.onmessage = ({ data }) => {
        if (settled) return;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          settle(new Error('E1 received invalid JSON'));
          return;
        }
        if (!event || typeof event !== 'object' || !('type' in event)) return;
        const wireMessage = event as Record<string, unknown>;
        const entries =
          wireMessage.type === 'events.batch' && Array.isArray(wireMessage.events)
            ? wireMessage.events
            : [{ event: wireMessage }];
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object' || !('event' in entry)) continue;
          const value = entry.event as Record<string, unknown>;
          lastEventType = String(value.type);
          if (value.type === 'approval.requested' || value.type === 'question.requested') {
            settle(new Error(`E1 unexpectedly required interaction: ${value.type}`));
            return;
          }
          if (value.type === 'error') {
            settle(new Error(String(value.message ?? 'E1 sidecar error')));
            return;
          }
          if (value.type === 'session.created' && value.clientRef === clientRef) {
            const session = value.session as Record<string, unknown>;
            appSessionId = String(session.appSessionId ?? '');
            providerSessionId = String(session.providerSessionId ?? '');
            if (
              !appSessionId ||
              !providerSessionId ||
              session.sessionPurpose !== 'chat' ||
              session.interactionMode !== 'auto' ||
              session.autonomy !== 'off' ||
              session.goal !== 'Reply with exactly E1_OK.'
            )
              settle(new Error('E1 creation contract drift'));
            continue;
          }
          if (value.type === 'event.appended') {
            const transcript = value.event as Record<string, unknown>;
            if (transcript.appSessionId === appSessionId && transcript.kind === 'text')
              textEvents += 1;
            if (transcript.appSessionId === appSessionId && transcript.kind === 'error') {
              settle(new Error(String(transcript.text ?? 'E1 provider error')));
              return;
            }
            if (
              transcript.appSessionId === appSessionId &&
              transcript.sourceSessionId === appSessionId &&
              transcript.role === 'primary' &&
              transcript.kind === 'text' &&
              transcript.author === undefined &&
              typeof transcript.text === 'string' &&
              transcript.text.trim()
            )
              assistantText += transcript.text;
            continue;
          }
          if (value.type === 'session.updated') {
            const session = value.session as Record<string, unknown>;
            if (session.appSessionId === appSessionId) {
              streaming = session.streaming === true;
              turnStarted ||= streaming;
              if (turnStarted && !streaming && !assistantText.trim()) {
                settle(
                  new Error(`E1 turn ended without assistant text (textEvents=${textEvents})`),
                );
                return;
              }
            }
            if (
              session.appSessionId === appSessionId &&
              session.streaming === false &&
              assistantText.trim() &&
              !closeSent
            )
              sendSessionClose();
            continue;
          }
          if (value.type === 'session.closed' && value.appSessionId === appSessionId && closeSent)
            settle();
        }
      };
    });
  }, BRIDGE_PROTOCOL_VERSION);
}

// Exercise the real Mission Control daemon without starting an autonomous mission.
// Exact live-child compaction and provider-failure behavior are covered through
// SessionManager's public commands in compactionLifecycle/childSettingsRaces.
async function runMissionControlSettingsSmoke(page: Page): Promise<void> {
  await page.evaluate(async (bridgeProtocol) => {
    const { port, token } = await window.droidControl!.bridgeInfo();
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}&bridgeProtocol=${bridgeProtocol}`,
    );
    await new Promise<void>((resolve, reject) => {
      const clientRef = `mc-smoke-${Date.now()}`;
      let appSessionId = '';
      let models: string[] = [];
      let compactionTokenLimit: unknown;
      let stage: 'catalog' | 'create' | 'worker' | 'validator' | 'close' = 'catalog';
      let settled = false;
      const send = (command: Record<string, unknown>) => socket.send(JSON.stringify(command));
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (error && appSessionId && stage !== 'close' && socket.readyState === WebSocket.OPEN)
          send({ type: 'session.close', appSessionId });
        socket.close();
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(
        () => finish(new Error(`Mission Control smoke timed out at ${stage}`)),
        45_000,
      );
      socket.onerror = () => finish(new Error('Mission Control bridge failed'));
      socket.onclose = () => finish(new Error('Mission Control bridge closed before completion'));
      socket.onopen = () => send({ type: 'catalog.models' });
      socket.onmessage = ({ data }) => {
        const wire = JSON.parse(data);
        const entries = wire.type === 'events.batch' ? wire.events : [{ event: wire }];
        for (const { event } of entries) {
          if (event.type === 'error') {
            finish(new Error(String(event.message)));
            return;
          }
          if (
            stage === 'catalog' &&
            event.type === 'catalog.updated' &&
            event.catalog === 'models'
          ) {
            models = event.items.map((model: { id: string }) => model.id);
            if (models.length < 2) {
              finish(new Error('Mission Control smoke requires two catalog models'));
              return;
            }
            stage = 'create';
            send({
              type: 'session.create',
              clientRef,
              title: 'Mission Control settings smoke',
              goal: '',
              sessionPurpose: 'mission-control',
              interactionMode: 'auto',
              autonomy: 'off',
              modelId: models[0],
              workerModel: models[0],
              validatorModel: models[0],
              compactionTokenLimit: 100_000,
            });
          }
          if (
            stage === 'create' &&
            event.type === 'session.created' &&
            event.clientRef === clientRef
          ) {
            const session = event.session;
            appSessionId = session.appSessionId;
            compactionTokenLimit = session.compactionTokenLimit;
            if (
              !appSessionId ||
              session.sessionPurpose !== 'mission-control' ||
              session.streaming ||
              typeof compactionTokenLimit !== 'number'
            ) {
              finish(new Error('Mission Control creation or compaction contract drift'));
              return;
            }
            stage = 'worker';
            send({
              type: 'settings.agent.update',
              appSessionId,
              agent: 'worker',
              modelId: models[1],
            });
          }
          if (event.type === 'session.updated' && event.session.appSessionId === appSessionId) {
            const session = event.session;
            if (
              session.modelId !== models[0] ||
              session.compactionTokenLimit !== compactionTokenLimit
            ) {
              finish(new Error('Role settings changed the primary model or compaction limit'));
              return;
            }
            if (stage === 'worker' && session.workerModelId === models[1]) {
              if (session.validatorModelId !== models[0]) {
                finish(new Error('Worker settings changed the validator'));
                return;
              }
              stage = 'validator';
              send({
                type: 'settings.agent.update',
                appSessionId,
                agent: 'validator',
                modelId: models[1],
              });
            } else if (stage === 'validator' && session.validatorModelId === models[1]) {
              if (session.workerModelId !== models[1]) {
                finish(new Error('Validator settings changed the worker'));
                return;
              }
              stage = 'close';
              send({ type: 'session.close', appSessionId });
            }
          }
          if (
            stage === 'close' &&
            event.type === 'session.closed' &&
            event.appSessionId === appSessionId
          )
            finish();
        }
      };
    });
  }, BRIDGE_PROTOCOL_VERSION);
}

test('[E1] Authenticated desktop round trip and Mission Control settings', async () => {
  const { FACTORY_API_KEY: apiKey, ...childEnv } = process.env;
  assert.equal(
    process.env.RUN_AUTHENTICATED_DROID_SMOKE,
    '1',
    'run npm run test:smoke:electron-droid',
  );
  const authMode = process.env.DROIDEX_SMOKE_AUTH ?? 'api-key';
  assert.ok(
    authMode === 'api-key' || authMode === 'cli',
    'DROIDEX_SMOKE_AUTH must be api-key or cli',
  );
  if (authMode === 'api-key') assert.ok(apiKey, 'FACTORY_API_KEY is required for api-key mode');
  else assert.ok(hasCliLogin(), 'Sign in with droid before running CLI-authenticated smoke');
  for (const artifact of ['dist/index.html', 'sidecar/dist/sidecar.mjs', 'electron/main.cjs'])
    assert.ok(existsSync(artifact), `missing ${artifact}`);
  const droidPath = resolveDroidPath();

  const home = mkdtempSync(path.join(tmpdir(), 'droid-control-e1-'));
  const profile = {
    config: path.join(home, 'config'),
    data: path.join(home, 'data'),
    localAppData: path.join(home, 'local-app-data'),
    roamingAppData: path.join(home, 'roaming-app-data'),
    userData: path.join(home, 'user-data'),
  };
  for (const directory of Object.values(profile)) mkdirSync(directory, { recursive: true });
  const bridgePort = await allocateLoopbackPort();
  const sidecar = path.resolve('sidecar/dist/sidecar.mjs');
  const sidecarEntry = writeIsolatedSidecarEntry(home, sidecar);
  const sidecarReadyProof = path.join(home, 'e1-sidecar-ready.json');
  const bootstrapUrl = createPreloadOnlyBootstrapUrl();
  const launchEnv = {
    ...childEnv,
    // CLI login uses the existing home/keychain explicitly; app data stays isolated.
    HOME: authMode === 'cli' ? homedir() : home,
    USERPROFILE: authMode === 'cli' ? homedir() : home,
    XDG_CONFIG_HOME: profile.config,
    XDG_DATA_HOME: profile.data,
    APPDATA: profile.roamingAppData,
    LOCALAPPDATA: profile.localAppData,
    DROIDEX_USER_DATA_DIR: profile.userData,
    // Claude Code's updater installs into XDG_DATA_HOME and links the launcher
    // to it; from this profile that would leave the launcher dangling once the
    // profile is deleted.
    DISABLE_UPDATES: '1',
    ELECTRON_START_URL: bootstrapUrl,
    DROID_PATH: droidPath,
    SIDECAR_ENTRY: sidecarEntry,
    SIDECAR_READY_PROOF: sidecarReadyProof,
    BRIDGE_PORT: String(bridgePort),
  };
  assert.equal(
    launchEnv.ELECTRON_START_URL,
    bootstrapUrl,
    'E1 did not pass the safe bootstrap URL to Electron.',
  );
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.resolve('electron/main.cjs'), `--user-data-dir=${profile.userData}`],
      cwd: process.cwd(),
      env: launchEnv,
    });
    const page = await app.firstWindow();
    await assertPreloadOnlyBootstrap(page, bootstrapUrl);
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    assert.equal(isWithin(home, userData), true, 'E1 userData escaped its isolated profile.');
    // This is the preload IPC boundary; no bridge socket may run until its
    // token is bound to the supervisor's readiness proof below.
    const bridge = await page.evaluate(() => window.droidControl!.bridgeInfo());
    assert.equal(bridge.port, bridgePort, 'E1 bridge did not report the selected port.');
    assert.equal(
      typeof bridge.token === 'string' && bridge.token.length > 0,
      true,
      'E1 bridge did not report an authentication token.',
    );
    await verifySidecarReadyProof(sidecarReadyProof, bridge);
    await verifyOwnedBridge(page, bridge);

    await page.evaluate(
      async (key) => {
        if (key) await window.droidControl!.setApiKey(key);
        await window.droidControl!.setOnboarding({
          completed: false,
          cliAutoUpdate: false,
          harnessCliAutoUpdate: false,
          appAutoUpdate: false,
        });
      },
      authMode === 'api-key' ? apiKey : undefined,
    );
    const rendererUrl = pathToFileURL(path.resolve('dist', 'index.html')).href;
    await page.goto(rendererUrl);
    assert.equal(page.url(), rendererUrl, 'E1 did not navigate to the built renderer.');
    await page.getByRole('button', { name: /Get started/i }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByText("You're signed in.")).toBeVisible();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Make it yours.', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('heading', { name: "You're all set.", exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start building', exact: true }).click();
    const onboarding = JSON.parse(
      readFileSync(path.join(userData, 'onboarding.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(
      {
        completed: onboarding['completed'],
        cliAutoUpdate: onboarding['cliAutoUpdate'],
        appAutoUpdate: onboarding['appAutoUpdate'],
      },
      { completed: true, cliAutoUpdate: false, appAutoUpdate: false },
    );
    await runMissionControlSettingsSmoke(page);
    const result = await runRoundTrip(page);
    expect(result.assistantText.trim()).toBe('E1_OK');
  } finally {
    try {
      await app?.close();
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});
