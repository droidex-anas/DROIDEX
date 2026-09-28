import {
  query,
  type ModelInfo as ClaudeModelInfo,
  type McpServerConfig as SdkMcpServerConfig,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@factory/droid-sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { nonEmptyEnv } from '../../droidexPaths.js';
import { reasoningValue } from '../../modelCatalog.js';
import type { ProviderStatus, ReasoningEffort } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderModelSettings,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { resolveClaudePath } from './claudeExecutable.js';
import { claudeCatalogItems } from './claudeCatalog.js';
import { claudeContextEnv, claudeContextModel } from './claudeContextWindow.js';
import { claudeDefaultModel, claudeModelRows } from './claudeModels.js';
import { ClaudeSession, type ClaudeSessionInput } from './claudeSession.js';

const PROBE_TIMEOUT_MS = 25_000;
const INSTALL_HINT = 'Claude Code CLI not found. Install it, then refresh.';

export class ClaudeProvider implements Provider {
  readonly kind = 'claude' as const;
  private models: ClaudeModelInfo[] = [];
  // The CLI's own name for the model a chat that pins none runs on, suffix
  // included. The catalog row published beside it is the unsuffixed one.
  private defaultLaunchModelId?: string;

  validateModelSettings(settings: ProviderModelSettings): void {
    claudeContextModel(
      settings.modelId ?? this.defaultLaunchModelId,
      settings.contextWindowTokens,
      this.models,
    );
  }

  async create({
    interactions,
    cwd,
    modelId,
    reasoningEffort,
    fastMode,
    contextWindowTokens,
    autonomyLevel,
    interactionMode,
    mcpServers,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Claude pins the id it is given, so the session mints DROIDEX's identity
    // here and the two stay the same for the session's whole life.
    return await this.open({
      appSessionId: randomUUID(),
      cwd: sessionCwd(cwd),
      autonomy: autonomyLevel ?? 'off',
      interactionMode,
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      fastMode: fastMode ?? false,
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
    });
  }

  async resume(
    providerSessionId: string,
    {
      interactions,
      cwd,
      modelId,
      reasoningEffort,
      fastMode,
      contextWindowTokens,
      autonomy,
      interactionMode,
      mcpServers,
    }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    return await this.open({
      appSessionId: providerSessionId,
      cwd: sessionCwd(cwd),
      autonomy: autonomy ?? 'off',
      interactionMode: interactionMode ?? 'auto',
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      fastMode: fastMode ?? false,
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
      resume: true,
    });
  }

  private async open(
    input: Omit<ClaudeSessionInput, 'executable' | 'models'>,
  ): Promise<ProviderSession> {
    const modelId = claudeContextModel(
      input.modelId ?? this.defaultLaunchModelId,
      input.contextWindowTokens,
      this.models,
    );
    const session = new ClaudeSession({
      ...input,
      modelId,
      models: this.models,
      executable: this.requireExecutable(),
    });
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
        env: claudeContextEnv(process.env, 1000000),
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: ['user'],
        settings: { disableAllHooks: true },
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
      const [catalog, commands] = await Promise.all([
        probe.supportedModels(),
        probe.supportedCommands(),
      ]);
      const settings = claudeSettings();
      const defaultModel = claudeDefaultModel(catalog, settings.model);
      this.models = catalog;
      this.defaultLaunchModelId = defaultModel?.launchModelId;
      return {
        provider: 'claude',
        readiness: 'ready',
        accountLabel: account,
        ...(defaultModel ? { defaultModelId: defaultModel.modelId } : {}),
        ...(defaultModel?.contextWindowTokens !== undefined
          ? { defaultContextWindowTokens: defaultModel.contextWindowTokens }
          : {}),
        models: claudeModelRows(catalog, settings.effortLevel),
        items: claudeCatalogItems(commands),
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

// The CLI keeps its own defaults under its config directory, which
// CLAUDE_CONFIG_DIR relocates. A file that is missing or unreadable simply
// names neither a model nor an effort.
function claudeSettings(): { model?: string; effortLevel?: ReasoningEffort } {
  const directory = nonEmptyEnv(process.env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude'));
  try {
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      model?: unknown;
      effortLevel?: unknown;
    };
    const model = typeof settings.model === 'string' ? settings.model.trim() : '';
    const effortLevel = reasoningValue(settings.effortLevel);
    return { ...(model ? { model } : {}), ...(effortLevel ? { effortLevel } : {}) };
  } catch {
    return {};
  }
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
