import { spawn, type ChildProcess } from 'node:child_process';

import type { DroidProxyProviderKey } from '../protocol.js';
import {
  loginFlagFor,
  readDroidProxyStatus,
  resolveCliProxyApi,
  type DroidProxyEvent,
} from './droidProxy.js';
import {
  applyDroidProxyFactoryModels,
  droidProxyModelsInstalled,
  droidProxySettingsModels,
} from './droidProxyFactoryModels.js';

// One OAuth login runs at a time: the flows open a browser and wait on a
// local callback, so parallel runs would fight over ports and windows.
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// Drives the DroidProxy settings page: status snapshots, browser OAuth logins
// through DroidProxy's bundled cli-proxy-api, launching the app, and merging
// the proxy model catalog into Factory settings.
export class DroidProxyController {
  private loginProcess: ChildProcess | undefined;

  constructor(private readonly emit: (event: DroidProxyEvent) => void) {}

  async report(): Promise<void> {
    const status = await readDroidProxyStatus();
    const providerEnabled = this.providerEnabledPredicate(status);
    const options = { contributorMode: status.metaContributorMode };
    this.emit({
      type: 'droidproxy.report',
      status: {
        ...status,
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
    if (this.loginProcess) return;
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
    this.loginProcess = child;
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
    // Cancellation is the only SIGTERM this child can receive: the watchdog
    // uses SIGKILL and a natural exit leaves no signal behind.
    const cancelled = child.signalCode === 'SIGTERM';
    this.loginProcess = undefined;
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
    this.loginProcess?.kill('SIGTERM');
  }

  async applyFactoryModels(): Promise<void> {
    const status = await readDroidProxyStatus();
    let result: { applied: number; removed: number; backupPath?: string };
    try {
      result = applyDroidProxyFactoryModels(this.providerEnabledPredicate(status), {
        contributorMode: status.metaContributorMode,
      });
    } catch (error) {
      this.emit({
        type: 'droidproxy.factoryModels.applied',
        ok: false,
        applied: 0,
        removed: 0,
        message: error instanceof Error ? error.message : 'Could not update Factory settings.',
      });
      return;
    }
    this.emit({
      type: 'droidproxy.factoryModels.applied',
      ok: true,
      applied: result.applied,
      removed: result.removed,
      ...(result.backupPath ? { backupPath: result.backupPath } : {}),
    });
    await this.report();
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
