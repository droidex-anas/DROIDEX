import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import type { ModelInfo, ProviderStatus } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { resolveClaudePath } from './claudeExecutable.js';
import { ClaudeSession } from './claudeSession.js';

const PROBE_TIMEOUT_MS = 25_000;
const INSTALL_HINT = 'Claude Code CLI not found. Install it, then refresh.';

export class ClaudeProvider implements Provider {
  readonly kind = 'claude' as const;

  create({
    interactions,
    cwd,
    modelId,
    autonomyLevel,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Claude pins the id it is given, so the session mints DROIDEX's identity
    // here and the two stay the same for the session's whole life.
    return Promise.resolve(
      new ClaudeSession({
        appSessionId: randomUUID(),
        executable: this.requireExecutable(),
        cwd,
        autonomy: autonomyLevel ?? 'low',
        ...(modelId ? { modelId } : {}),
        interactions,
      }),
    );
  }

  resume(
    providerSessionId: string,
    { interactions, cwd, modelId, autonomy }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    return Promise.resolve(
      new ClaudeSession({
        appSessionId: providerSessionId,
        executable: this.requireExecutable(),
        cwd: cwd ?? tmpdir(),
        autonomy: autonomy ?? 'low',
        ...(modelId ? { modelId } : {}),
        interactions,
        resume: true,
      }),
    );
  }

  // What Claude Code can do for the user right now. The prompt never yields, so
  // the CLI starts, reports its capabilities and is torn down without a turn
  // ever reaching the API.
  async probe(signal: AbortSignal): Promise<ProviderStatus> {
    const executable = resolveClaudePath();
    if (!executable)
      return { provider: 'claude', readiness: 'missing', message: INSTALL_HINT, models: [] };

    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', () => {
      abort.abort();
    });
    const probe = query({
      prompt: idlePrompt(abort.signal),
      options: {
        abortController: abort,
        cwd: tmpdir(),
        pathToClaudeCodeExecutable: executable,
        persistSession: false,
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: [],
      },
    });
    try {
      const init = await probe.initializationResult();
      const account = accountLabel(init.account);
      if (!account)
        return {
          provider: 'claude',
          readiness: 'unauthenticated',
          message: 'Run `claude` in a terminal and sign in, then refresh.',
          models: [],
        };
      const models = await probe.supportedModels();
      return {
        provider: 'claude',
        readiness: 'ready',
        accountLabel: account,
        models: models.map(providerModel),
      };
    } catch (error) {
      return claudeProbeFailure(error);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  private requireExecutable(): string {
    const executable = resolveClaudePath();
    if (!executable) throw new Error(INSTALL_HINT);
    return executable;
  }
}

// An account the CLI can actually generate with: a signed-in subscription, or
// a configured key. Nothing here means the user still has to log in.
function accountLabel(account: {
  email?: string;
  organization?: string;
  tokenSource?: string;
  apiKeySource?: string;
}): string | undefined {
  return (
    account.email ??
    account.organization ??
    account.tokenSource ??
    account.apiKeySource ??
    undefined
  );
}

function providerModel(model: { value: string; displayName: string }): ModelInfo {
  return {
    id: model.value,
    displayName: model.displayName,
    provider: 'anthropic',
    isCustom: false,
  };
}

const LOGIN_MARKERS = ['not logged in', 'log in', 'login', 'authenticat', 'oauth', 'api key'];

function claudeProbeFailure(error: unknown): ProviderStatus {
  const message = error instanceof Error ? error.message : String(error);
  const readiness = LOGIN_MARKERS.some((marker) => message.toLowerCase().includes(marker))
    ? 'unauthenticated'
    : 'error';
  return { provider: 'claude', readiness, message, models: [] };
}

// A prompt that never yields: the CLI initializes and then waits, so the probe
// costs a process and no tokens.
// eslint-disable-next-line require-yield -- yielding here would send a prompt, which is the one thing a probe must not do.
async function* idlePrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => {
      resolve();
    });
  });
}
