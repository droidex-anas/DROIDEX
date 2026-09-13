import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { isExecutable, resolveOnPathSync } from '../../Environment.js';
import { reasoningValue } from '../../modelCatalog.js';
import type { ModelInfo, ProviderStatus, ReasoningEffort } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { AppServerClient } from './appServer.js';
import { CodexSession, type CodexSessionInput } from './codexSession.js';

// Codex only echoes this back in its user agent. The sidecar is not told the
// app's version, so `0.0.0` stands for "unknown" outside a dev run.
const CLIENT_INFO = {
  name: 'droidex',
  title: 'DROIDEX',
  version: process.env.npm_package_version ?? '0.0.0',
};

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
    if (!executable)
      return { provider: 'codex', readiness: 'missing', message: INSTALL_HINT, models: [] };
    // A refresh cancelled during shutdown must not leave a process behind.
    if (signal.aborted)
      return { provider: 'codex', readiness: 'error', message: PROBE_CANCELLED, models: [] };

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
      const { userAgent } = await initialize(client);
      const account = await client.request<AccountResponse>('account/read', {});
      if (!account.account && account.requiresOpenaiAuth)
        return {
          provider: 'codex',
          readiness: 'unauthenticated',
          message: LOGIN_HINT,
          models: [],
        };
      const version = codexVersion(userAgent);
      const label = accountLabel(account.account);
      return {
        provider: 'codex',
        readiness: 'ready',
        ...(version ? { version } : {}),
        ...(label ? { accountLabel: label } : {}),
        models: await listModels(client),
      };
    } catch (error) {
      const message = deadline.expired ? 'Codex did not answer in time.' : errorMessage(error);
      return { provider: 'codex', readiness: 'error', message, models: [] };
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

interface CodexModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}

async function listModels(client: AppServerClient): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await client.request(
      'model/list',
      cursor ? { cursor } : {},
    );
    // A model with no id cannot be selected and one with no name cannot be
    // shown, so neither belongs in the picker.
    for (const model of page.data) {
      if (model.id.trim() && model.displayName.trim()) models.push(providerModel(model));
    }
    cursor = page.nextCursor;
  } while (cursor);
  return models;
}

function providerModel(model: CodexModel): ModelInfo {
  const efforts = model.supportedReasoningEfforts
    .map((option) => reasoningValue(option.reasoningEffort))
    .filter((effort): effort is ReasoningEffort => effort !== undefined);
  const fallback = reasoningValue(model.defaultReasoningEffort);
  return {
    id: model.id,
    displayName: model.displayName,
    provider: 'openai',
    isCustom: false,
    isDefault: model.isDefault,
    ...(efforts.length > 0 ? { supportedReasoningEfforts: efforts } : {}),
    ...(fallback ? { defaultReasoningEffort: fallback } : {}),
  };
}
