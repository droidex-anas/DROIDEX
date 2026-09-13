import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { nonEmptyEnv } from '../../droidexPaths.js';
import { isExecutable, resolveOnPathSync } from '../../Environment.js';
import type { ModelInfo, ProviderStatus } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { AppServerClient } from './appServer.js';
import { listModels } from './codexModels.js';
import { CodexSession, type CodexSessionInput } from './codexSession.js';

// Codex only echoes this back in its user agent. The sidecar is not told the
// app's version, so `0.0.0` stands for "unknown" outside a dev run.
const CLIENT_INFO = {
  name: 'droidex',
  title: 'DROIDEX',
  version: process.env.npm_package_version ?? '0.0.0',
};

// The app-server releases this build was written against. `experimentalApi`
// exposes shapes that move between releases, so a CLI outside the range is
// refused rather than half-supported.
const SUPPORTED_VERSIONS = { prefix: '0.149.', label: '0.149.x' };
const PROBE_TIMEOUT_MS = 25_000;
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

export interface InitializeResponse {
  userAgent: string;
}

// Every connection starts here, after its handlers are registered: the
// capability opt-in that exposes the thread and turn API, then the bare
// `initialized` notification Codex waits for before serving anything else.
export async function initialize(client: AppServerClient): Promise<InitializeResponse> {
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
      autonomy: autonomyLevel ?? 'low',
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
        autonomy: autonomy ?? 'low',
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
  // reports its version, its account and its models, and is then torn down.
  async probe(signal: AbortSignal): Promise<ProviderStatus> {
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
    try {
      // The gate comes first: an unsupported CLI is reported as such, not as
      // whatever its account call happens to say about a protocol this build
      // does not speak.
      const { userAgent } = await initialize(client);
      const version = codexVersion(userAgent);
      if (!version) return unavailable('error', `Codex did not report a version (${userAgent}).`);
      if (!version.startsWith(SUPPORTED_VERSIONS.prefix))
        return unavailable(
          'unsupported',
          `Codex ${version} is installed; this build supports ${SUPPORTED_VERSIONS.label}.`,
          version,
        );
      const account = await client.request<AccountResponse>('account/read', {});
      if (!account.account && account.requiresOpenaiAuth)
        return unavailable('unauthenticated', LOGIN_HINT);
      const label = accountLabel(account.account);
      const models = await listModels(client);
      const defaultModelId = (await configuredModel(client)) ?? defaultModel(models);
      return {
        provider: 'codex',
        readiness: 'ready',
        version,
        ...(label ? { accountLabel: label } : {}),
        ...(defaultModelId ? { defaultModelId } : {}),
        models,
      };
    } catch (error) {
      return unavailable(
        'error',
        deadline.expired ? 'Codex did not answer in time.' : errorMessage(error),
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      await client.close();
    }
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
      await session.open(resumeId);
    } catch (error) {
      // A session that never opened must not leave its process behind.
      await client.close();
      throw error;
    }
    return session;
  }
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

function defaultModel(models: ModelInfo[]): string | undefined {
  return models.find((model) => model.isDefault)?.id;
}

