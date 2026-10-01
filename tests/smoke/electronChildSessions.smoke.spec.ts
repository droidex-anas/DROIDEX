import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

type RecordedCommand = {
  type: string;
  parentAppSessionId?: string;
  childSessionId?: string;
  text?: string;
  cursor?: string;
  factoryApiKeyConfigured?: boolean;
  droidPathConfigured?: boolean;
};

interface SmokeResources {
  smokeHome: string;
  fixtureProcess?: ChildProcessWithoutNullStreams;
  app?: ElectronApplication;
}

const FIXTURE_EXIT_TIMEOUT_MS = 5_000;

async function startFixture(
  logPath: string,
  environment: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {},
  onSpawn: (child: ChildProcessWithoutNullStreams) => void = () => undefined,
): Promise<{ process: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(
    process.execPath,
    [path.resolve('sidecar/test-fixtures/childSessionsSidecar.mjs')],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        BRIDGE_PORT: '0',
        BRIDGE_TOKEN: '',
        BRIDGE_EXIT_ON_STDIN_CLOSE: '1',
        CHILD_SESSIONS_SMOKE_ALLOW_ANY_TOKEN: '1',
        CHILD_SESSIONS_SMOKE_LOG: logPath,
        ...overrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  onSpawn(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const fail = (error: unknown) => {
      child.kill();
      reject(error);
    };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Smoke fixture exited before ready (${code}).`)));
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/SIDECAR_READY (\d+)/);
      if (!match) return;
      child.removeListener('error', fail);
      child.removeAllListeners('exit');
      resolve({ process: child, port: Number(match[1]) });
    });
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = FIXTURE_EXIT_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish();
    const timeout = setTimeout(
      () => finish(new Error(`Smoke fixture did not exit within ${String(timeoutMs)}ms.`)),
      timeoutMs,
    );
    child.once('error', onError);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

async function stopFixture(
  fixture: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (fixture.exitCode === null && fixture.signalCode === null) fixture.stdin.end();
  try {
    await waitForExit(fixture, timeoutMs);
  } catch (gracefulError) {
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill('SIGKILL');
    try {
      await waitForExit(fixture);
    } catch {
      throw gracefulError;
    }
  }
}

async function cleanupSmokeResources(
  resources: SmokeResources,
  fixtureExitTimeoutMs = FIXTURE_EXIT_TIMEOUT_MS,
): Promise<void> {
  try {
    await resources.app?.close();
  } finally {
    try {
      const fixture = resources.fixtureProcess;
      if (fixture) await stopFixture(fixture, fixtureExitTimeoutMs);
    } finally {
      rmSync(resources.smokeHome, { recursive: true, force: true });
    }
  }
}

function recordedCommands(logPath: string): RecordedCommand[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordedCommand);
}

async function waitForCommand(
  logPath: string,
  predicate: (command: RecordedCommand) => boolean,
): Promise<RecordedCommand> {
  await expect
    .poll(() => recordedCommands(logPath).find(predicate), { timeout: 10_000 })
    .not.toBeUndefined();
  return recordedCommands(logPath).find(predicate)!;
}

test('[E2] parent-scoped agents pane preserves the primary chat', async () => {
  for (const artifact of [
    'dist/index.html',
    'electron/main.cjs',
    'sidecar/test-fixtures/childSessionsSidecar.mjs',
  ]) {
    assert.ok(existsSync(artifact), `missing ${artifact}`);
  }

  const smokeHome = mkdtempSync(path.join(tmpdir(), 'droid-control-child-sessions-'));
  const profile = {
    config: path.join(smokeHome, 'config'),
    data: path.join(smokeHome, 'data'),
    localAppData: path.join(smokeHome, 'local-app-data'),
    roamingAppData: path.join(smokeHome, 'roaming-app-data'),
    userData: path.join(smokeHome, 'user-data'),
  };
  for (const directory of Object.values(profile)) mkdirSync(directory, { recursive: true });

  const commandLog = path.join(smokeHome, 'commands.jsonl');
  const bootstrapUrl = `data:text/html;charset=utf-8,${encodeURIComponent(
    '<!doctype html><html><body>Child-session smoke bootstrap</body></html>',
  )}`;
  const {
    FACTORY_API_KEY: _factoryApiKey,
    DROID_PATH: _droidPath,
    ...unauthenticatedEnvironment
  } = process.env;

  const resources: SmokeResources = { smokeHome };
  try {
    const launchEnvironment = {
      ...unauthenticatedEnvironment,
      HOME: smokeHome,
      USERPROFILE: smokeHome,
      XDG_CONFIG_HOME: profile.config,
      XDG_DATA_HOME: profile.data,
      APPDATA: profile.roamingAppData,
      LOCALAPPDATA: profile.localAppData,
      DROIDEX_USER_DATA_DIR: profile.userData,
      ELECTRON_START_URL: bootstrapUrl,
      SIDECAR_ENTRY: path.resolve('sidecar/test-fixtures/childSessionsSidecar.mjs'),
      BRIDGE_PORT: '0',
      CHILD_SESSIONS_SMOKE_LOG: commandLog,
      NODE_BIN: process.execPath,
    };
    const app = await electron.launch({
      args: [path.resolve('electron/main.cjs'), `--user-data-dir=${profile.userData}`],
      cwd: process.cwd(),
      env: launchEnvironment,
    });
    resources.app = app;
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      await window.droidControl!.setOnboarding({
        completed: true,
        cliAutoUpdate: false,
        appAutoUpdate: false,
      });
    });
    await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);

    const fixtureStart = await waitForCommand(
      commandLog,
      (command) => command.type === 'fixture.start',
    );
    assert.equal(fixtureStart.factoryApiKeyConfigured, false);
    assert.equal(fixtureStart.droidPathConfigured, false);

    const leftNavigation = page.getByTestId('left-navigation');
    await expect(leftNavigation.getByText('Parent Alpha', { exact: true })).toBeVisible();
    await expect(leftNavigation.getByText('Parent Beta', { exact: true })).toBeVisible();
    await expect(leftNavigation.getByText('Alpha Worker Shared', { exact: true })).toHaveCount(0);
    await expect(leftNavigation.locator('[data-app-session-id]')).toHaveCount(2);

    await leftNavigation.locator('[data-app-session-id="parent-alpha"]').click();
    const chat = page.getByTestId('chat-view');
    await expect(chat.getByText('ALPHA PRIMARY OUTPUT', { exact: true })).toBeVisible();

    const rightPanel = page.getByTestId('right-context-panel');
    await expect(rightPanel).toBeVisible();
    const subagentsSummary = rightPanel.getByTestId('subagents-summary');
    const subagents = page.getByRole('dialog', { name: 'Subagents', exact: true });
    await subagentsSummary.click();
    await expect(subagents.locator('[data-child-session-id]')).toHaveCount(3);
    await expect(subagents.getByText('Alpha Worker Shared', { exact: true })).toBeVisible();
    await expect(subagents.getByText('Alpha Worker Two', { exact: true })).toBeVisible();
    await expect(subagents.getByText('Alpha Historical Worker', { exact: true })).toBeVisible();

    await subagents
      .locator('[data-child-session-id="shared-child"]')
      .locator('button')
      .first()
      .click();
    const workspace = page.getByTestId('agents-workspace');
    const detail = workspace.getByTestId('agent-pane-detail');
    await expect(detail.getByText('ALPHA SHARED CHILD OUTPUT', { exact: true })).toBeVisible();
    await expect(chat.getByText('ALPHA PRIMARY OUTPUT', { exact: true })).toBeVisible();
    await expect(chat.getByText('ALPHA SHARED CHILD OUTPUT', { exact: true })).toHaveCount(0);
    await expect(detail.getByRole('textbox')).toHaveCount(0);

    await detail.getByRole('button', { name: 'Back to agents', exact: true }).click();
    const agentList = workspace.getByTestId('agent-pane-list');
    await expect(agentList.getByTestId('agent-pane-row')).toHaveCount(3);
    await agentList.locator('[data-child-session-id="alpha-sibling"]').click();
    await expect(detail.getByText('Alpha Worker Two', { exact: true })).toBeVisible();
    const conversationScroll = detail.locator('div.overflow-y-auto').first();
    await expect
      .poll(() => conversationScroll.locator('[data-feed-row-id]').count())
      .toBeGreaterThan(0);
    await expect
      .poll(() => conversationScroll.locator('[data-feed-row-id]').count())
      .toBeLessThan(80);
    await conversationScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(detail.getByText('ALPHA CHILD TWO OUTPUT', { exact: false })).toBeVisible();
    await expect(chat.getByText('ALPHA PRIMARY OUTPUT', { exact: true })).toBeVisible();
    await expect(chat.getByText('ALPHA CHILD TWO OUTPUT', { exact: false })).toHaveCount(0);
    await expect
      .poll(() =>
        conversationScroll
          .locator('[data-feed-row-id]')
          .evaluateAll(
            (rows) =>
              rows.filter(
                (row) =>
                  row instanceof HTMLElement && Boolean(row.style.opacity || row.style.transform),
              ).length,
          ),
      )
      .toBe(0);

    await detail.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'Collapse', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await detail.getByRole('button', { name: 'Collapse', exact: true }).click();
    await expect(chat.getByText('ALPHA PRIMARY OUTPUT', { exact: true })).toBeVisible();

    await leftNavigation.locator('[data-app-session-id="parent-beta"]').click();
    await expect(chat.getByText('BETA PRIMARY OUTPUT', { exact: true })).toBeVisible();
    await expect(page.getByText('ALPHA CHILD TWO OUTPUT', { exact: false })).toHaveCount(0);
    await expect(agentList.getByTestId('agent-pane-row')).toHaveCount(1);
    await expect(agentList.getByText('Beta Worker Shared', { exact: true })).toBeVisible();
    await expect(agentList.getByText('Alpha Worker Shared', { exact: true })).toHaveCount(0);
    await agentList.locator('[data-child-session-id="shared-child"]').click();
    await expect(detail.getByText('BETA SHARED CHILD OUTPUT', { exact: true })).toBeVisible();
    await expect(detail.getByText('ALPHA SHARED CHILD OUTPUT', { exact: true })).toHaveCount(0);
    await expect(chat.getByText('BETA PRIMARY OUTPUT', { exact: true })).toBeVisible();
    await expect(leftNavigation.getByText('Beta Worker Shared', { exact: true })).toHaveCount(0);

    await leftNavigation.locator('[data-app-session-id="parent-alpha"]').click();
    await detail.getByRole('button', { name: 'Back to agents', exact: true }).click();
    await agentList.locator('[data-child-session-id="alpha-history"]').click();
    await expect(detail.getByText('Alpha Historical Worker', { exact: true })).toBeVisible();
    await expect
      .poll(() => conversationScroll.locator('[data-feed-row-id]').count())
      .toBeGreaterThan(0);
    await expect
      .poll(() => conversationScroll.locator('[data-feed-row-id]').count())
      .toBeLessThan(80);
    await conversationScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(detail.getByText('ALPHA HISTORICAL OUTPUT', { exact: true })).toBeVisible();
    await expect(chat.getByText('ALPHA PRIMARY OUTPUT', { exact: true })).toBeVisible();
    await expect(chat.getByText('ALPHA HISTORICAL OUTPUT', { exact: true })).toHaveCount(0);
    await expect(leftNavigation.locator('[data-app-session-id]')).toHaveCount(2);
    assert.equal(
      recordedCommands(commandLog).some(
        (command) =>
          command.type === 'child.open' ||
          command.type === 'child.send' ||
          command.type === 'child.interrupt',
      ),
      false,
      'Reading an agent must not open or mutate its runtime.',
    );
  } finally {
    await cleanupSmokeResources(resources);
  }
});

test('[E2] pre-ready fixture failure cleans the temporary profile and process', async () => {
  const smokeHome = mkdtempSync(path.join(tmpdir(), 'droid-control-child-startup-failure-'));
  const commandLog = path.join(smokeHome, 'commands.jsonl');
  const {
    FACTORY_API_KEY: _factoryApiKey,
    DROID_PATH: _droidPath,
    ...unauthenticatedEnvironment
  } = process.env;
  const resources: SmokeResources = { smokeHome };

  try {
    await assert.rejects(
      startFixture(commandLog, unauthenticatedEnvironment, { BRIDGE_PORT: '65536' }, (child) => {
        resources.fixtureProcess = child;
      }),
      /Smoke fixture exited before ready/,
    );
  } finally {
    await cleanupSmokeResources(resources);
  }

  assert.equal(existsSync(smokeHome), false);
  assert.ok(resources.fixtureProcess);
  assert.ok(
    resources.fixtureProcess.exitCode !== null || resources.fixtureProcess.signalCode !== null,
  );
});

test('[E2] cleanup force-stops a fixture that ignores stdin closure', async () => {
  const smokeHome = mkdtempSync(path.join(tmpdir(), 'droid-control-child-cleanup-timeout-'));
  const resources: SmokeResources = { smokeHome };
  let fixtureProcess: ChildProcessWithoutNullStreams | undefined;
  let stoppedByCleanup = false;

  try {
    fixtureProcess = spawn(
      process.execPath,
      [
        '-e',
        "process.stdout.write('HANGING_READY\\n'); process.stdin.resume(); setInterval(() => {}, 1000);",
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    resources.fixtureProcess = fixtureProcess;
    await new Promise<void>((resolve, reject) => {
      fixtureProcess.once('error', reject);
      fixtureProcess.once('exit', (code) =>
        reject(new Error(`Hanging fixture exited before ready (${String(code)}).`)),
      );
      fixtureProcess.stdout.once('data', () => resolve());
    });
    await cleanupSmokeResources(resources, 25);
    stoppedByCleanup = fixtureProcess.exitCode !== null || fixtureProcess.signalCode !== null;
  } finally {
    const fixture = resources.fixtureProcess;
    if (fixture && fixture.exitCode === null && fixture.signalCode === null)
      fixture.kill('SIGKILL');
    if (fixture) await waitForExit(fixture).catch(() => undefined);
    rmSync(smokeHome, { recursive: true, force: true });
  }

  assert.equal(stoppedByCleanup, true);
  assert.ok(fixtureProcess);
  assert.equal(fixtureProcess.signalCode, 'SIGKILL');
  assert.equal(existsSync(smokeHome), false);
});
