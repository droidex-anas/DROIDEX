import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import { runStreaming, type ShellCommand } from '../CliInstaller.js';
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
  update: ShellCommand;
}

// The binary the provider would spawn, followed to the file it links to: that
// file's location names the installer that owns it, and so the command that
// can replace it. Each updater is invoked by the path the install itself
// implies, since a GUI-launched app does not inherit the shell's PATH.
export function locateInstall(path: string, resolvedPath: string): InstalledCli {
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
    if (!install) {
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
      exitCode = await runStreaming(install.update, ({ line }) => {
        lastLine = line;
      });
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
    const version = await installedVersion(install.path);
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
