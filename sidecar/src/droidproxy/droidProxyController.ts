import { spawn, type ChildProcess } from 'node:child_process';

import type { DroidProxyInstallPhase, DroidProxyProviderKey } from '../protocol.js';
import {
  droidProxyAppPath,
  loginFlagFor,
  readDroidProxyStatus,
  resolveCliProxyApi,
  type DroidProxyEvent,
} from './droidProxy.js';
import { installDroidProxyApp } from './droidProxyInstall.js';
import {
  applyDroidProxyFactoryModels,
  droidProxyModelsInstalled,
  droidProxySettingsModels,
} from './droidProxyFactoryModels.js';

// One OAuth login runs at a time: the flows open a browser and wait on a
// local callback, so parallel runs would fight over ports and windows.
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// One login's live state: the child, its provider for status reports, and
// whether Cancel was requested (a binary that catches SIGTERM exits with a
// code and no signal, so the signal alone cannot prove cancellation).
interface ActiveLogin {
  child: ChildProcess;
  provider: DroidProxyProviderKey;
  cancelRequested: boolean;
}

type FactoryApplyOutcome =
  | { ok: true; applied: number; removed: number; backupPath?: string }
  | { ok: false; message: string };

// Drives the DroidProxy settings page: status snapshots, browser OAuth logins
// through DroidProxy's bundled cli-proxy-api, launching the app, and merging
// the proxy model catalog into Factory settings.
export class DroidProxyController {
  private activeLogin: ActiveLogin | undefined;
  private installAbort: AbortController | undefined;
  private installPhase: DroidProxyInstallPhase | undefined;

  constructor(private readonly emit: (event: DroidProxyEvent) => void) {}

  async report(): Promise<void> {
    const status = await readDroidProxyStatus();
    const providerEnabled = this.providerEnabledPredicate(status);
    const options = { contributorMode: status.metaContributorMode };
    const running = this.activeLogin;
    const installing = this.installPhase;
    this.emit({
      type: 'droidproxy.report',
      status: {
        ...status,
        ...(running ? { loginInProgress: running.provider } : {}),
        ...(installing ? { installInProgress: installing } : {}),
        factoryModelCount: droidProxySettingsModels(providerEnabled, options).length,
        factoryModelsInstalled: droidProxyModelsInstalled(providerEnabled, options),
      },
    });
  }

  async launchApp(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('DroidProxy is a macOS app.');
    }
    const child = spawn('open', ['-a', 'DroidProxy'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    // The proxy takes a moment to bind; re-probe so the page settles on truth.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await this.report();
  }

  async login(provider: DroidProxyProviderKey): Promise<void> {
    if (this.activeLogin) return;
    const flag = loginFlagFor(provider);
    const backend = resolveCliProxyApi();
    if (!flag || !backend) {
      this.emit({
        type: 'droidproxy.login.done',
        provider,
        ok: false,
        message: `No assisted login for ${provider} without the DroidProxy app installed.`,
      });
      return;
    }
    this.emit({ type: 'droidproxy.login.started', provider });
    const child = spawn(backend.binary, ['--config', backend.config, flag], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const active: ActiveLogin = { child, provider, cancelRequested: false };
    this.activeLogin = active;
    // Codex pauses on a manual callback prompt; a newline keeps it waiting for
    // the browser instead, the same nudge DroidProxy sends.
    let codexNudge: NodeJS.Timeout | undefined;
    if (provider === 'codex') {
      codexNudge = setTimeout(() => {
        try {
          child.stdin.write('\n');
        } catch {
          // The process may already have exited; completion handles it.
        }
      }, 12_000);
    }
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, LOGIN_TIMEOUT_MS);
    killTimer.unref();
    let output = '';
    const capture = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 8000) output = output.slice(-8000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let spawnError: Error | undefined;
    await new Promise<void>((resolve) => {
      child.on('error', (error) => {
        spawnError = error;
        resolve();
      });
      child.on('close', () => {
        resolve();
      });
    });
    clearTimeout(killTimer);
    if (codexNudge) clearTimeout(codexNudge);
    // Cancel owns its own bit: a binary that catches SIGTERM exits with a code
    // and no signal, which would otherwise read as a failed login.
    const cancelled = active.cancelRequested || child.signalCode === 'SIGTERM';
    this.activeLogin = undefined;
    if (cancelled) {
      this.emit({ type: 'droidproxy.login.done', provider, ok: false, cancelled: true });
      await this.report();
      return;
    }
    const ok = child.exitCode === 0 && !spawnError;
    this.emit({
      type: 'droidproxy.login.done',
      provider,
      ok,
      ...(ok ? {} : { message: loginFailureMessage(output, spawnError) }),
    });
    await this.report();
  }

  cancelLogin(): void {
    if (!this.activeLogin) return;
    this.activeLogin.cancelRequested = true;
    this.activeLogin.child.kill('SIGTERM');
  }

  // One-click setup: download, verify, install, launch, and apply models,
  // all behind progress events. A second call while one runs just re-reports.
  async install(): Promise<boolean> {
    if (this.installPhase || droidProxyAppPath()) {
      await this.report();
      return false;
    }
    const abort = new AbortController();
    this.installAbort = abort;
    this.installPhase = 'downloading';
    let lastPhase: DroidProxyInstallPhase | undefined;
    let lastEmit = 0;
    try {
      const result = await installDroidProxyApp((progress) => {
        this.installPhase = progress.phase;
        // Download chunks arrive faster than the UI can use them; phase
        // changes always go through immediately.
        const now = Date.now();
        if (progress.phase === lastPhase && now - lastEmit < 150) return;
        lastPhase = progress.phase;
        lastEmit = now;
        this.emit({
          type: 'droidproxy.install.progress',
          phase: progress.phase,
          ...(progress.receivedBytes === undefined
            ? {}
            : { receivedBytes: progress.receivedBytes }),
          ...(progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
        });
      }, abort.signal);
      this.installAbort = undefined;
      if (!result.ok) {
        this.emit({
          type: 'droidproxy.install.done',
          ok: false,
          ...(result.cancelled ? { cancelled: true } : {}),
          message: result.message,
        });
        return false;
      }

      this.installPhase = 'launching';
      this.emit({ type: 'droidproxy.install.progress', phase: 'launching' });
      await this.launchApp();
      const proxyUp = await this.waitForProxy();
      this.installPhase = 'applying';
      this.emit({ type: 'droidproxy.install.progress', phase: 'applying' });
      const applied = await this.writeFactoryModels();
      if (!applied.ok) {
        this.emit({
          type: 'droidproxy.install.done',
          ok: false,
          message: `DroidProxy installed, but models could not be applied: ${applied.message}`,
        });
        return false;
      }
      this.emit({
        type: 'droidproxy.install.done',
        ok: true,
        ...(proxyUp
          ? {}
          : { message: 'Installed, but the proxy is not up yet. Open the app if it stays down.' }),
      });
      return true;
    } catch (error) {
      this.emit({
        type: 'droidproxy.install.done',
        ok: false,
        message: error instanceof Error ? error.message : 'DroidProxy setup failed.',
      });
      return false;
    } finally {
      this.installAbort = undefined;
      this.installPhase = undefined;
      await this.report();
    }
  }

  cancelInstall(): void {
    this.installAbort?.abort();
  }

  private async waitForProxy(): Promise<boolean> {
    for (let attempt = 0; attempt < 15; attempt++) {
      if ((await readDroidProxyStatus()).proxyRunning) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  async applyFactoryModels(): Promise<boolean> {
    const result = await this.writeFactoryModels();
    if (!result.ok) {
      this.emit({
        type: 'droidproxy.factoryModels.applied',
        ok: false,
        applied: 0,
        removed: 0,
        message: result.message,
      });
      return false;
    }
    this.emit({
      type: 'droidproxy.factoryModels.applied',
      ok: true,
      applied: result.applied,
      removed: result.removed,
      ...(result.backupPath ? { backupPath: result.backupPath } : {}),
    });
    await this.report();
    return true;
  }

  private async writeFactoryModels(): Promise<FactoryApplyOutcome> {
    try {
      const status = await readDroidProxyStatus();
      const result = applyDroidProxyFactoryModels(this.providerEnabledPredicate(status), {
        contributorMode: status.metaContributorMode,
      });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not update Factory settings.',
      };
    }
  }

  private providerEnabledPredicate(status: {
    providers: { provider: DroidProxyProviderKey; enabled: boolean }[];
  }) {
    const enabled = new Map<string, boolean>(
      status.providers.map((row) => [row.provider, row.enabled]),
    );
    return (providerKey: string) => enabled.get(providerKey) ?? true;
  }
}

function lastMeaningfulLine(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines[lines.length - 1].slice(0, 500) : undefined;
}

// Failure detail for the bridge: the login binary's own last words, unless
// they carry a URL, code, or token-shaped secret. OAuth errors echo callback
// URLs and exchange payloads, so anything URL- or secret-shaped is replaced
// rather than forwarded into toasts and logs.
function loginFailureMessage(output: string, spawnError?: Error): string {
  if (spawnError) return `Could not start sign-in: ${spawnError.message}`.slice(0, 300);
  const line = lastMeaningfulLine(output);
  if (!line) return 'Sign-in did not complete.';
  if (/https?:\/\/\S+|[?&](code|token|secret|key)=[^&\s]+/i.test(line)) {
    return 'Sign-in failed. Try again from the DroidProxy app for details.';
  }
  return line;
}
