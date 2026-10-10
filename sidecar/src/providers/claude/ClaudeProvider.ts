import {
  forkSession,
  getSessionMessages,
  query,
  type ModelInfo as ClaudeModelInfo,
  type McpServerConfig as SdkMcpServerConfig,
  type Query,
  type SDKUserMessage,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@factory/droid-sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { nonEmptyEnv } from '../../droidexPaths.js';
import { reasoningValue } from '../../modelCatalog.js';
import { objectValue } from '../../values.js';
import type { ProviderStatus, ReasoningEffort } from '../../protocol.js';
import type {
  Provider,
  ProviderForkHandle,
  ProviderForkSource,
  ProviderOpenInput,
  ProviderModelSettings,
  ProviderResumeInput,
  ProviderSession,
  UsageMetersListener,
  UsageReading,
} from '../session.js';
import { resolveClaudePath } from './claudeExecutable.js';
import { claudeCatalogItems } from './claudeCatalog.js';
import { childEnv } from '../../childEnv.js';
import { claudeContextEnv } from './claudeContextWindow.js';
import {
  claudeDefaultModel,
  claudeLaunchModel,
  claudeModelRows,
  type ClaudeDefaultModel,
} from './claudeModels.js';
import { readClaudeUsage } from './claudeRateLimits.js';
import { ClaudeSession, type ClaudeSessionInput } from './claudeSession.js';

const PROBE_TIMEOUT_MS = 25_000;
const PROBE_CANCELLED = 'Claude Code was not checked.';
const INSTALL_HINT = 'Claude Code CLI not found. Install it, then refresh.';

export class ClaudeProvider implements Provider {
  readonly kind = 'claude' as const;
  private models: ClaudeModelInfo[] = [];
  // The model a chat that pins none runs on: the row published for it and the
  // CLI's own name for it, suffix included.
  private defaultModel?: ClaudeDefaultModel;

  constructor(private readonly onUsage?: UsageMetersListener) {}

  validateModelSettings(settings: ProviderModelSettings): void {
    claudeLaunchModel(
      settings.modelId ?? undefined,
      settings.contextWindowTokens,
      this.models,
      this.defaultModel,
    );
  }

  async create({
    appSessionId,
    interactions,
    cwd,
    modelId,
    reasoningEffort,
    fastMode,
    contextWindowTokens,
    autonomy,
    interactionMode,
    mcpServers,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Claude pins the supplied id for a new conversation.
    return await this.open({
      appSessionId: appSessionId ?? randomUUID(),
      cwd: sessionCwd(cwd),
      autonomy,
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
      appSessionId,
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
      appSessionId,
      cwd: sessionCwd(cwd),
      autonomy: autonomy ?? 'off',
      interactionMode: interactionMode ?? 'auto',
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      fastMode: fastMode ?? false,
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
      resumeId: providerSessionId,
    });
  }

  // Claude Code keeps a session under the project directory it ran in, which is
  // where resume looks for it too. A fork point is the uuid of the prompt that
  // opened the answer's turn, so the copy runs through that turn's last message.
  // The copy gives every message a fresh uuid, so its prompts are renamed.
  async fork({
    providerSessionId,
    cwd,
    title,
    forkPointId,
  }: ProviderForkSource): Promise<ProviderForkHandle> {
    const dir = sessionCwd(cwd);
    const messages = await getSessionMessages(providerSessionId, { dir });
    const copied = forkPointId ? messagesThroughTurn(messages, forkPointId) : messages;
    const { sessionId } = await forkSession(providerSessionId, {
      dir,
      title,
      ...(forkPointId ? { upToMessageId: copied[copied.length - 1].uuid } : {}),
    });
    return {
      providerSessionId: sessionId,
      forkPointRenames: await renamedPrompts(copied, sessionId, dir),
    };
  }

  private async open(
    input: Omit<ClaudeSessionInput, 'executable' | 'models' | 'onUsage'>,
  ): Promise<ProviderSession> {
    const modelId = claudeLaunchModel(
      input.modelId,
      input.contextWindowTokens,
      this.models,
      this.defaultModel,
    );
    const session = new ClaudeSession({
      ...input,
      modelId,
      models: this.models,
      ...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
      executable: this.requireExecutable(),
      ...(this.onUsage ? { onUsage: this.onUsage } : {}),
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
    // A refresh cancelled while this provider loaded must not start the CLI:
    // the abort it would have listened for has already fired.
    if (signal.aborted)
      return { provider: 'claude', readiness: 'error', message: PROBE_CANCELLED, models: [] };

    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', () => {
      abort.abort();
    });
    const probe = idleQuery(executable, abort, claudeContextEnv(childEnv(), 1000000));
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
      this.defaultModel = defaultModel;
      return {
        provider: 'claude',
        readiness: 'ready',
        accountLabel: account,
        ...(defaultModel ? { defaultModelId: defaultModel.modelId } : {}),
        ...(defaultModel?.contextWindowTokens !== undefined
          ? { defaultContextWindowTokens: defaultModel.contextWindowTokens }
          : {}),
        models: claudeModelRows(catalog, settings.effortLevel, defaultModel),
        items: claudeCatalogItems(commands),
      };
    } catch (error) {
      return claudeProbeFailure(error);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  // The probe's idle CLI, with the claude.ai connectors and IDE discovery off
  // too, since it only has to answer the usage call.
  async readUsage(signal: AbortSignal): Promise<UsageReading> {
    const executable = this.requireExecutable();
    signal.throwIfAborted();
    const abort = new AbortController();
    const stop = () => {
      abort.abort();
    };
    signal.addEventListener('abort', stop);
    const probe = idleQuery(executable, abort, {
      ...childEnv(),
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
    });
    try {
      await probe.initializationResult();
      // The usage call takes no signal, so it must not start once cancelled.
      signal.throwIfAborted();
      return await readClaudeUsage(probe);
    } finally {
      signal.removeEventListener('abort', stop);
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

function messagesThroughTurn(messages: SessionMessage[], promptUuid: string): SessionMessage[] {
  const turnStart = messages.findIndex((message) => message.uuid === promptUuid);
  if (turnStart < 0) throw new Error('Claude Code no longer has this answer to fork from.');
  const nextTurn = messages.findIndex((message, index) => index > turnStart && isPrompt(message));
  return nextTurn < 0 ? messages : messages.slice(0, nextTurn);
}

// The SDK records tool results as user messages too; a prompt is what the user sent.
function isPrompt(message: SessionMessage): boolean {
  if (message.type !== 'user' || message.parent_tool_use_id !== null) return false;
  const content = objectValue(message.message)?.content;
  return (
    !Array.isArray(content) || !content.some((block) => objectValue(block)?.type === 'tool_result')
  );
}

// The copy is the same chain under fresh uuids, so its messages pair with the
// source's by position. A copy that does not line up renames nothing, and its
// earlier answers then cannot be forked again.
async function renamedPrompts(
  source: SessionMessage[],
  copySessionId: string,
  dir: string,
): Promise<Map<string, string>> {
  const copy = await getSessionMessages(copySessionId, { dir });
  const renames = new Map<string, string>();
  if (copy.length !== source.length) return renames;
  source.forEach((message, index) => {
    if (isPrompt(message)) renames.set(message.uuid, copy[index].uuid);
  });
  return renames;
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

// A CLI that starts, answers control requests and is torn down without a turn
// ever reaching the API: no hooks, no MCP servers, no tools, no session file.
function idleQuery(executable: string, abort: AbortController, env: NodeJS.ProcessEnv): Query {
  return query({
    prompt: idlePrompt(abort.signal),
    options: {
      abortController: abort,
      cwd: tmpdir(),
      pathToClaudeCodeExecutable: executable,
      persistSession: false,
      env,
      allowedTools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: ['user'],
      settings: { disableAllHooks: true },
    },
  });
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
