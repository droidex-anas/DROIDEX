import {
  PROVIDER_LABELS,
  providerUnavailableReason,
} from '../../features/providers/providerIdentity';
import type {
  EnvironmentReport,
  HarnessCliState,
  HarnessInstallSource,
  InstallChannel,
  ProviderKind,
  ProviderStatus,
} from '../../types/bridge';

// The agents setup offers, in the order it lists them.
export const AGENTS: readonly ProviderKind[] = ['droid', 'claude', 'codex'];

export const AGENT_MAKERS: Record<ProviderKind, string> = {
  droid: 'Factory',
  claude: 'Anthropic',
  codex: 'OpenAI',
};

export interface AgentInstall {
  path?: string;
  version?: string;
  /** The installer that put the CLI here, when the app can tell. */
  source?: string;
}

// Where one agent stands on this Mac. Droid needs a sign-in to run, but Claude
// Code and Codex can reach their models through a gateway their own config
// names, so either one still starts chats without one (`canRun`).
export type AgentStatus =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'unavailable'; reason: string }
  | { state: 'signin'; install: AgentInstall; canRun: boolean }
  | { state: 'ready'; install: AgentInstall; account: string };

export type AgentStatuses = Record<ProviderKind, AgentStatus>;

const SOURCE_LABELS: Record<HarnessInstallSource, string> = {
  homebrew: 'Homebrew',
  npm: 'npm',
  native: 'the native installer',
  chatgpt: 'the ChatGPT app',
};

export function droidStatus(env: EnvironmentReport | null): AgentStatus {
  if (!env) return { state: 'checking' };
  if (!env.cli.present) return { state: 'missing' };
  const install: AgentInstall = {
    path: env.cli.path,
    ...(env.cli.version ? { version: env.cli.version } : {}),
  };
  if (env.auth.loginPresent) return { state: 'ready', install, account: 'Factory account' };
  if (env.auth.apiKeyConfigured) return { state: 'ready', install, account: 'API key' };
  return { state: 'signin', install, canRun: false };
}

// The provider status decides readiness, since it is what chats run on; the
// CLI report adds where the binary lives and which installer owns it.
export function harnessStatus(
  status: ProviderStatus | undefined,
  cli: HarnessCliState | undefined,
): AgentStatus {
  if (!status) return { state: 'checking' };
  const version = cli?.installed ? (cli.version ?? status.version) : status.version;
  const install: AgentInstall = {
    ...(cli?.installed ? { path: cli.path, source: SOURCE_LABELS[cli.source] } : {}),
    ...(version ? { version } : {}),
  };
  switch (status.readiness) {
    case 'missing':
      return { state: 'missing' };
    case 'unsupported':
    case 'error':
      return { state: 'unavailable', reason: providerUnavailableReason(status) ?? 'Unavailable' };
    case 'unauthenticated':
      return { state: 'signin', install, canRun: false };
    case 'ready':
      if (status.accountLabel) return { state: 'ready', install, account: status.accountLabel };
      return { state: 'signin', install, canRun: true };
  }
}

export function canStartChats(status: AgentStatus): boolean {
  return status.state === 'ready' || (status.state === 'signin' && status.canRun);
}

export function needsSetup(status: AgentStatus): boolean {
  return status.state === 'missing' || status.state === 'signin';
}

/** The agents someone ticked or unticked; the rest follow `chosenAgents`. */
export type AgentPicks = Partial<Record<ProviderKind, boolean>>;

// An agent nobody has ticked or unticked is chosen when it is Droid or this
// Mac already has it signed in.
export function chosenAgents(picks: AgentPicks, statuses: AgentStatuses): ProviderKind[] {
  return AGENTS.filter(
    (agent) => picks[agent] ?? (agent === 'droid' || statuses[agent].state === 'ready'),
  );
}

// The next chosen agent after `after` that still needs installing or signing
// in, wrapping round, so setup walks through them one at a time.
export function nextToSetUp(
  chosen: readonly ProviderKind[],
  statuses: AgentStatuses,
  after: ProviderKind | null,
  skipped: readonly ProviderKind[],
): ProviderKind | null {
  const start = after === null ? 0 : chosen.indexOf(after) + 1;
  const rotated = [...chosen.slice(start), ...chosen.slice(0, start)];
  return rotated.find((agent) => needsSetup(statuses[agent]) && !skipped.includes(agent)) ?? null;
}

// New chats need an agent that can run now: the preference if it can, else
// the first chosen agent that can. With none, the preference stands.
export function startingAgent(
  chosen: readonly ProviderKind[],
  statuses: AgentStatuses,
  preferred: ProviderKind,
): ProviderKind {
  const runnable = chosen.filter((agent) => canStartChats(statuses[agent]));
  if (runnable.includes(preferred)) return preferred;
  return runnable[0] ?? preferred;
}

export interface InstallOption {
  channel: InstallChannel;
  label: string;
  /** What the installer runs, as someone would type it. */
  command: string;
}

// Each agent's documented installers, matching the commands the sidecar runs
// (CliInstaller for Droid, harnessCli for Claude Code and Codex). Codex
// publishes no install script.
const INSTALL_OPTIONS: Record<ProviderKind, InstallOption[]> = {
  droid: [
    {
      channel: 'script',
      label: 'Official installer',
      command: 'curl -fsSL https://app.factory.ai/cli | sh',
    },
    { channel: 'brew', label: 'Homebrew', command: 'brew install --cask droid' },
    { channel: 'npm', label: 'npm', command: 'npm install -g @factory/cli' },
  ],
  claude: [
    {
      channel: 'script',
      label: 'Native installer',
      command: 'curl -fsSL https://claude.ai/install.sh | bash',
    },
    { channel: 'brew', label: 'Homebrew', command: 'brew install --cask claude-code' },
    { channel: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/claude-code' },
  ],
  codex: [
    { channel: 'brew', label: 'Homebrew', command: 'brew install --cask codex' },
    { channel: 'npm', label: 'npm', command: 'npm install -g @openai/codex' },
  ],
};

// The installers this Mac can run for an agent, in the order setup offers them.
export function installOptions(
  agent: ProviderKind,
  available: readonly InstallChannel[],
): InstallOption[] {
  return INSTALL_OPTIONS[agent].filter((option) => available.includes(option.channel));
}

// The picked installer while it is still offered, else the first one offered.
export function installOptionFor(
  options: readonly InstallOption[],
  picked: InstallChannel | undefined,
): InstallOption | null {
  return options.find((option) => option.channel === picked) ?? options.at(0) ?? null;
}

/** "Droid", "Droid and Codex", "Droid, Claude Code and Codex". */
export function joinNames(agents: readonly ProviderKind[]): string {
  const names = agents.map((agent) => PROVIDER_LABELS[agent]);
  const last = names.pop();
  if (last === undefined) return '';
  return names.length === 0 ? last : `${names.join(', ')} and ${last}`;
}
