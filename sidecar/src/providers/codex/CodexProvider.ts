import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { nonEmptyEnv } from '../../droidexPaths.js';
import { isExecutable, resolveOnPathSync } from '../../Environment.js';
import type { ModelInfo, ProviderStatus, SkillInfo } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { AppServerClient } from './appServer.js';
import { CodexCatalog } from './codexCatalog.js';
import { listModels } from './codexModels.js';
import { CodexSession, type CodexSessionInput } from './codexSession.js';

// Codex only echoes this back in its user agent. The sidecar is not told the
// app's version, so `0.0.0` stands for "unknown" outside a dev run.
const CLIENT_INFO = {
  name: 'droidex',
  title: 'DROIDEX',
  version: process.env.npm_package_version ?? '0.0.0',
};

// The oldest app-server this build was written against. `experimentalApi`
// exposes shapes that settled in this release (v2 threads, `turn/steer`,
// reasoning summaries), so an older CLI is refused rather than half-supported;
// newer releases keep the protocol and are accepted.
const MINIMUM_VERSION = '0.149.0';
const PROBE_TIMEOUT_MS = 25_000;
// The probe's catalog has no reader waiting on it, only a process to release.
const CATALOG_TIMEOUT_MS = 60_000;
const INSTALL_HINT = 'Codex CLI not found. Install it, then refresh.';
const LOGIN_HINT = 'Run `codex login` in a terminal and sign in, then refresh.';
const PROBE_CANCELLED = 'Codex was not checked.';

// Mirrors the Droid and Claude CLI resolution order (Environment.ts): an
// explicit override first, then the locations the installers use, then PATH.
const CLI_CANDIDATES = [
  join(homedir(), '.local', 'bin', 'codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
];

function resolveCodexPath(): string | undefined {
  const override = process.env.CODEX_PATH;
  if (override && isExecutable(override)) return override;
  return CLI_CANDIDATES.find((candidate) => isExecutable(candidate)) ?? resolveOnPathSync('codex');
}

interface InitializeResponse {
  userAgent: string;
}

// Every connection starts here, after its handlers are registered: the
// capability opt-in that exposes the thread and turn API, then the bare
// `initialized` notification Codex waits for before serving anything else.
async function initialize(client: AppServerClient): Promise<InitializeResponse> {
  const response = await client.request<InitializeResponse>('initialize', {
    clientInfo: CLIENT_INFO,
    capabilities: { experimentalApi: true },
  });
  client.notify('initialized');
  return response;
}

export class CodexProvider implements Provider {
  readonly kind = 'codex' as const;

  create({
    interactions,
    cwd,
    modelId,
    reasoningEffort,
    autonomyLevel,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Codex mints the thread id, so DROIDEX's own identity is minted here and
    // the thread becomes the session's separate resume handle.
    return this.openSession({
      appSessionId: randomUUID(),
      cwd,
      autonomy: autonomyLevel ?? 'off',
      model: {
        ...(modelId ? { modelId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      interactions,
    });
  }

  resume(
    providerSessionId: string,
    { interactions, cwd, modelId, reasoningEffort, autonomy, resumeId }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    if (!resumeId)
      throw new Error('This Codex session has no stored thread and cannot be reopened.');
    return this.openSession(
      {
        appSessionId: providerSessionId,
        cwd: cwd ?? tmpdir(),
        autonomy: autonomy ?? 'off',
        model: {
          ...(modelId ? { modelId } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
        interactions,
      },
      resumeId,
    );
  }

  // What Codex can do for the user right now: one app-server process that
  // reports its version, its account and its models. Its catalog follows from
  // the same process, which is torn down once the last source has answered.
  async probe(
    signal: AbortSignal,
    publishItems: (items: SkillInfo[]) => void,
  ): Promise<ProviderStatus> {
    const executable = resolveCodexPath();
    if (!executable) return unavailable('missing', INSTALL_HINT);
    // A refresh cancelled during shutdown must not leave a process behind.
    if (signal.aborted) return unavailable('error', PROBE_CANCELLED);

    const client = new AppServerClient(executable, tmpdir());
    const deadline = { expired: false };
    const stop = () => {
      void client.close();
    };
    const timer = setTimeout(() => {
      deadline.expired = true;
      stop();
    }, PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', stop);
    let status: ProviderStatus;
    try {
      status = await readiness(client);
    } catch (error) {
      status = unavailable(
        'error',
        deadline.expired ? 'Codex did not answer in time.' : errorMessage(error),
      );
    } finally {
      clearTimeout(timer);
    }
    if (status.readiness !== 'ready') {
      signal.removeEventListener('abort', stop);
      await client.close();
      return status;
    }
    // Readiness never waits for the catalog: its first app listing can take
    // tens of seconds while Codex discovers connectors, so each source is
    // published as it lands and the process ends with the last one.
    const catalog = new CodexCatalog(client, [tmpdir()]);
    catalog.onUpdated(publishItems);
    client.onClose(() => {
      signal.removeEventListener('abort', stop);
      // Requests the close rejected are not failed sources.
      catalog.close();
    });
    const release = setTimeout(stop, CATALOG_TIMEOUT_MS);
    void catalog.catalogItems().then(() => {
      clearTimeout(release);
      stop();
    });
    return status;
  }

  private async openSession(
    input: Omit<CodexSessionInput, 'client'>,
    resumeId?: string,
  ): Promise<ProviderSession> {
    const executable = resolveCodexPath();
    if (!executable) throw new Error(INSTALL_HINT);
    const client = new AppServerClient(executable, input.cwd);
    // The session registers its handlers in its constructor, so the handshake
    // that makes Codex start sending can only follow it.
    const session = new CodexSession({ ...input, client });
    try {
      await initialize(client);
      if (!input.model.modelId) {
        // Resuming without an override otherwise inherits the thread's last
        // model, not the provider default the picker advertises.
        const configured = await configuredModel(client);
        const modelId = publishedDefault(await listModels(client, configured), configured);
        if (modelId) await session.setModel({ modelId });
      }
      await session.open(resumeId);
    } catch (error) {
      // A session that never opened must not leave its process behind.
      await client.close();
      throw error;
    }
    return session;
  }
}

// The gate comes first: an unsupported CLI is reported as such, not as
// whatever its account call happens to say about a protocol this build does
// not speak.
async function readiness(client: AppServerClient): Promise<ProviderStatus> {
  const { userAgent } = await initialize(client);
  const version = codexVersion(userAgent);
  if (!version) return unavailable('error', `Codex did not report a version (${userAgent}).`);
  if (!atLeast(version, MINIMUM_VERSION))
    return unavailable(
      'unsupported',
      `Codex ${version} is installed; this build needs ${MINIMUM_VERSION} or newer.`,
      version,
    );
  const account = await client.request<AccountResponse>('account/read', {});
  if (!account.account && account.requiresOpenaiAuth)
    return unavailable('unauthenticated', LOGIN_HINT);
  const label = accountLabel(account.account);
  const configured = await configuredModel(client);
  const models = await listModels(client, configured);
  const defaultModelId = publishedDefault(models, configured);
  return {
    provider: 'codex',
    readiness: 'ready',
    version,
    ...(label ? { accountLabel: label } : {}),
    ...(defaultModelId ? { defaultModelId } : {}),
    models,
  };
}

// A provider that cannot run offers no models, whatever the reason.
function unavailable(
  readiness: Exclude<ProviderStatus['readiness'], 'ready'>,
  message: string,
  version?: string,
): ProviderStatus {
  return { provider: 'codex', readiness, message, models: [], ...(version ? { version } : {}) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CodexAccount = { type: string; email?: string | null; planType?: string } | null;

interface AccountResponse {
  account: CodexAccount;
  requiresOpenaiAuth: boolean;
}

// Who the CLI is signed in as, for the picker's secondary line.
function accountLabel(account: CodexAccount): string | undefined {
  if (!account) return undefined;
  return account.email ?? account.planType ?? account.type;
}

// The user agent reads `<client>/<codex version> (...)`, and is the only place
// the running CLI reports its own version.
function codexVersion(userAgent: string): string | undefined {
  return /\/(\S+)/.exec(userAgent)?.[1];
}

// Dot-separated numeric comparison; anything after the digits of a part
// (a pre-release tag) does not count.
function atLeast(version: string, minimum: string): boolean {
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [have, need] = [parts(version), parts(minimum)];
  for (let index = 0; index < need.length; index += 1) {
    const [a, b] = [have[index] ?? 0, need[index] ?? 0];
    if (a !== b) return a > b;
  }
  return true;
}
// The model a new thread starts on, in the order the CLI resolves it: the
// effective config the app server serves, then the `model` key of config.toml
// for a server that will not serve it — one that cannot parse the whole config
// refuses the request, and the file still names the setting the CLI reads.
async function configuredModel(client: AppServerClient): Promise<string | undefined> {
  try {
    const { config } = await client.request<{ config: { model?: string | null } }>(
      'config/read',
      {},
    );
    if (typeof config.model === 'string' && config.model.trim()) return config.model;
  } catch {
    // The file below is the same setting, read without the server's help.
  }
  return configFileModel();
}

// The top-level `model` key, read only until the first table header so a model
// named inside a profile or a provider table is never mistaken for the default.
function configFileModel(): string | undefined {
  const home = nonEmptyEnv(process.env.CODEX_HOME, join(homedir(), '.codex'));
  try {
    for (const line of readFileSync(join(home, 'config.toml'), 'utf8').split(/\r?\n/)) {
      const text = line.trim();
      if (text.startsWith('[')) return undefined;
      const match = /^model\s*=\s*["']([^"']+)["']/.exec(text);
      if (match) return match[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// The default row has to name a model the catalog publishes, or it would offer
// no reasoning efforts to pick from. A configured model Codex no longer knows
// is not one it can run either, so the catalog's own default stands in.
function publishedDefault(
  models: ModelInfo[],
  configuredId: string | undefined,
): string | undefined {
  const configured = models.find((model) => model.id === configuredId);
  return (configured ?? models.find((model) => model.isDefault))?.id;
}
