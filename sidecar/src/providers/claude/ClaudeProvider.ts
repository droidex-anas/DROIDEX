import {
  query,
  type McpServerConfig as SdkMcpServerConfig,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@factory/droid-sdk';
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
import { ClaudeSession, type ClaudeSessionInput } from './claudeSession.js';

const PROBE_TIMEOUT_MS = 25_000;
const INSTALL_HINT = 'Claude Code CLI not found. Install it, then refresh.';

export class ClaudeProvider implements Provider {
  readonly kind = 'claude' as const;

  async create({
    interactions,
    cwd,
    modelId,
    autonomyLevel,
    mcpServers,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Claude pins the id it is given, so the session mints DROIDEX's identity
    // here and the two stay the same for the session's whole life.
    return await this.open({
      appSessionId: randomUUID(),
      cwd: sessionCwd(cwd),
      autonomy: autonomyLevel ?? 'low',
      ...(modelId ? { modelId } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
    });
  }

  async resume(
    providerSessionId: string,
    { interactions, cwd, modelId, autonomy, mcpServers }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    return await this.open({
      appSessionId: providerSessionId,
      cwd: sessionCwd(cwd),
      autonomy: autonomy ?? 'low',
      ...(modelId ? { modelId } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
      resume: true,
    });
  }

  private async open(input: Omit<ClaudeSessionInput, 'executable'>): Promise<ProviderSession> {
    const session = new ClaudeSession({ ...input, executable: this.requireExecutable() });
    try {
      await session.start();
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
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
      return {
        provider: 'claude',
        readiness: 'ready',
        accountLabel: account,
        models: (await probe.supportedModels()).flatMap(providerModel),
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

// An account the CLI can actually generate with: a signed-in subscription, or a
// configured key. The CLI reports 'none' for a source it does not have, so a
// blank or 'none' value is no account at all and the user still has to log in.
function accountLabel(account: {
  email?: string;
  organization?: string;
  tokenSource?: string;
  apiKeySource?: string;
}): string | undefined {
  return [account.email, account.organization, account.tokenSource, account.apiKeySource]
    .map((value) => value?.trim() ?? '')
    .find((value) => value !== '' && value.toLowerCase() !== 'none');
}

// A catalog entry missing its id or label cannot be selected or shown, so it is
// dropped rather than published as a blank row.
function providerModel(model: { value: string; displayName: string }): ModelInfo[] {
  const id = model.value.trim();
  const displayName = model.displayName.trim();
  if (!id || !displayName) return [];
  return [{ id, displayName, provider: 'anthropic', isCustom: false }];
}

// Claude Code runs in the directory the chat is anchored to; a folderless chat
// gets a real directory rather than an empty string the CLI would reject.
function sessionCwd(cwd: string | undefined): string {
  return cwd?.trim() ? cwd : tmpdir();
}

// The servers the lifecycle started for this session, in the SDK's own shape.
// Every Droid config form (stdio, http, sse) has an equivalent, so none is
// dropped; the SDK keys them by name where Droid carries the name inline.
function sdkMcpServers(configs: McpServerConfig[] | undefined): Record<string, SdkMcpServerConfig> {
  const servers: Record<string, SdkMcpServerConfig> = {};
  for (const config of configs ?? []) {
    if (!('command' in config)) {
      servers[config.name] = {
        type: config.type,
        url: config.url,
        headers: Object.fromEntries(config.headers.map((header) => [header.name, header.value])),
      };
      continue;
    }
    servers[config.name] = {
      type: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }
  return servers;
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
