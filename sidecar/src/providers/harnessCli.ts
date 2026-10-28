import { execFile, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import {
  completedProcessExitCode,
  streamingInvocation,
  type ShellCommand,
} from '../CliInstaller.js';
import { isExecutable } from '../Environment.js';
import type {
  HarnessCliProvider,
  HarnessCliState,
  HarnessInstallSource,
  ServerEvent,
} from '../protocol.js';
import { resolveClaudePath } from './claude/claudeExecutable.js';
import { resolveCodexPath } from './codex/codexExecutable.js';
import { childEnv } from '../childEnv.js';

const HARNESS_CLI_PROVIDERS: readonly HarnessCliProvider[] = ['claude', 'codex'];
const VERSION_TIMEOUT_MS = 10_000;

const execFileAsync = promisify(execFile);

type HarnessCliEvent = Extract<ServerEvent, { type: `harness.cli.${string}` }>;

interface InstalledCli {
  path: string;
  source: HarnessInstallSource;
  // Null when the app that ships the CLI updates it, not DROIDEX.
  update: ShellCommand | null;
}

// The binary the provider would spawn, followed to the file it links to: that
// file's location names the installer that owns it, and so the command that
// can replace it. Each updater is invoked by the path the install itself
// implies, since a GUI-launched app does not inherit the shell's PATH.
export function locateInstall(path: string, resolvedPath: string): InstalledCli {
  if (resolvedPath.includes('/ChatGPT.app/Contents/'))
    return { path, source: 'chatgpt', update: null };
  const brew = /^(.*)\/(Caskroom|Cellar)\/([^/]+)\//.exec(resolvedPath);
  if (brew) {
    const [, prefix, kind, token] = brew;
    return {
      path,
      source: 'homebrew',
      update: {
        command: join(prefix, 'bin', 'brew'),
        args: ['upgrade', ...(kind === 'Caskroom' ? ['--cask'] : []), token],
      },
    };
  }
  const npm = /^(.*)\/lib\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(resolvedPath);
  if (npm) {
    const [, prefix, packageName] = npm;
    const bin = join(prefix, 'bin');
    const npmPath = join(bin, 'npm');
    return {
      path,
      source: 'npm',
      update: {
        command: isExecutable(npmPath) ? npmPath : 'npm',
        args: ['install', '--global', `${packageName}@latest`],
        // npm is a Node script; the install's own Node must be the one found.
        env: { ...process.env, PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter) },
      },
    };
  }
  // Both CLIs' own installers update themselves in place.
  return { path, source: 'native', update: { command: path, args: ['update'] } };
}

function resolveHarnessPath(provider: HarnessCliProvider): string | undefined {
  return provider === 'claude' ? resolveClaudePath() : resolveCodexPath();
}

function findInstall(provider: HarnessCliProvider): InstalledCli | undefined {
  const path = resolveHarnessPath(provider);
  if (!path) return undefined;
  try {
    return locateInstall(path, realpathSync(path));
  } catch {
    return undefined;
  }
}

// `claude --version` prints `2.1.280 (Claude Code)`, `codex --version`
// prints `codex-cli 0.156.1`; the version is the first dotted number either way.
async function installedVersion(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(path, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
      env: childEnv(),
    });
    return /\d+\.\d+\.\d+[\w.-]*/.exec(stdout)?.[0];
  } catch {
    return undefined;
  }
}

// A package manager replaces a CLI in steps, so an updater must finish even if
// DROIDEX quits halfway: a pipe to the sidecar would break with it and kill
// `brew` or `npm` between removing the old version and linking the new one.
// The updater writes to a file instead, in its own process group.
async function runUpdater(cmd: ShellCommand): Promise<{ exitCode: number; lastLine?: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'droidex-harness-update-'));
  const logPath = join(dir, 'output.log');
  const log = await open(logPath, 'w');
  try {
    const invocation = streamingInvocation(cmd);
    let spawnError: string | undefined;
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(invocation.command, invocation.args, {
        shell: false,
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: childEnv(invocation.env ?? process.env),
      });
      child.on('error', (error) => {
        spawnError = error.message;
        resolve(1);
      });
      child.on('exit', (code) => {
        resolve(completedProcessExitCode(code));
      });
    });
    const lines = (await readFile(logPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = spawnError ?? lines.at(-1);
    return { exitCode, ...(lastLine ? { lastLine } : {}) };
  } finally {
    await log.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// Detects and updates the Claude Code and Codex CLIs through whichever
// installer owns each binary. One update per harness runs at a time.
export class HarnessCliUpdater {
  private readonly updating = new Set<HarnessCliProvider>();
  private readonly updateErrors = new Map<HarnessCliProvider, string>();

  constructor(
    private readonly emit: (event: HarnessCliEvent) => void,
    // Runs after a successful update: the new binary may offer new models.
    private readonly afterUpdate: () => Promise<void>,
  ) {}

  async report(): Promise<void> {
    const clis = await Promise.all(HARNESS_CLI_PROVIDERS.map((provider) => this.state(provider)));
    this.emit({ type: 'harness.cli.report', clis });
  }

  async update(provider: HarnessCliProvider): Promise<void> {
    if (!HARNESS_CLI_PROVIDERS.includes(provider)) {
      throw new Error(`No updatable CLI for provider: ${provider}`);
    }
    if (this.updating.has(provider)) return;
    const install = findInstall(provider);
    if (!install?.update) {
      await this.report();
      return;
    }
    this.updating.add(provider);
    let previousVersion: string | undefined;
    let lastLine: string | undefined;
    let exitCode: number;
    try {
      previousVersion = await installedVersion(install.path);
      await this.report();
      ({ exitCode, lastLine } = await runUpdater(install.update));
    } finally {
      this.updating.delete(provider);
    }
    const ok = exitCode === 0;
    if (ok) {
      this.updateErrors.delete(provider);
    } else {
      // An updater's last output line usually names why it stopped.
      this.updateErrors.set(provider, lastLine ?? `Updater exited with code ${String(exitCode)}.`);
    }
    // An update can move where the CLI resolves: one run through the version
    // store writes the launcher back.
    const version = await installedVersion(resolveHarnessPath(provider) ?? install.path);
    this.emit({
      type: 'harness.cli.update.done',
      provider,
      ok,
      ...(previousVersion ? { previousVersion } : {}),
      ...(version ? { version } : {}),
    });
    await this.report();
    if (ok) await this.afterUpdate();
  }

  private async state(provider: HarnessCliProvider): Promise<HarnessCliState> {
    const install = findInstall(provider);
    if (!install) return { provider, installed: false };
    const version = await installedVersion(install.path);
    const updateError = this.updateErrors.get(provider);
    return {
      provider,
      installed: true,
      path: install.path,
      source: install.source,
      ...(version ? { version } : {}),
      updating: this.updating.has(provider),
      ...(updateError ? { updateError } : {}),
    };
  }
}
