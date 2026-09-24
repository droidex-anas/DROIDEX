import {
  query,
  type EffortLevel,
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
import type { ModelInfo, ProviderStatus, ReasoningEffort } from '../../protocol.js';
import type {
  Provider,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
} from '../session.js';
import { resolveClaudePath } from './claudeExecutable.js';
import { claudeCatalogItems } from './claudeCatalog.js';
import { ClaudeSession, type ClaudeSessionInput } from './claudeSession.js';

const PROBE_TIMEOUT_MS = 25_000;
const INSTALL_HINT = 'Claude Code CLI not found. Install it, then refresh.';

export class ClaudeProvider implements Provider {
  readonly kind = 'claude' as const;

  async create({
    interactions,
    cwd,
    modelId,
    reasoningEffort,
    autonomyLevel,
    interactionMode,
    mcpServers,
  }: ProviderOpenInput): Promise<ProviderSession> {
    // Claude pins the id it is given, so the session mints DROIDEX's identity
    // here and the two stay the same for the session's whole life.
    return await this.open({
      appSessionId: randomUUID(),
      cwd: sessionCwd(cwd),
      autonomy: autonomyLevel ?? 'low',
      interactionMode,
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      mcpServers: sdkMcpServers(mcpServers),
      interactions,
    });
  }

  async resume(
    providerSessionId: string,
    { interactions, cwd, modelId, reasoningEffort, autonomy, mcpServers }: ProviderResumeInput,
  ): Promise<ProviderSession> {
    // A stored chat carries no interaction mode of its own, so a reopened one
    // starts in Chat the way the sidebar shows it.
    return await this.open({
      appSessionId: providerSessionId,
      cwd: sessionCwd(cwd),
      autonomy: autonomy ?? 'low',
      interactionMode: 'auto',
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
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
      const defaultModelId = claudeDefaultModelId(catalog, settings.model);
      return {
        provider: 'claude',
        readiness: 'ready',
        accountLabel: account,
        ...(defaultModelId ? { defaultModelId } : {}),
        // The recommended row is the CLI's own name for "no model of your own",
        // which is what DROIDEX's default row already means, so it is resolved
        // above rather than listed as a model of its own.
        models: catalog
          .filter((model) => model.value !== RECOMMENDED)
          .flatMap((model) => providerModel(model, settings.effortLevel)),
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

// The catalog row the CLI publishes for "whatever is recommended", rather than
// for a model of its own.
const RECOMMENDED = 'default';

interface ClaudeModel {
  value: string;
  displayName: string;
  description?: string;
  resolvedModel?: string;
  supportedEffortLevels?: EffortLevel[];
}

// The model a new Claude Code session starts on, named the way the catalog names
// it: the CLI's own `model` setting when the user configured one, otherwise the
// row it recommends. Either can name a model by alias or by wire id, so both are
// resolved back to the row the picker lists.
function claudeDefaultModelId(
  models: ClaudeModel[],
  configured: string | undefined,
): string | undefined {
  const recommended = models.find((model) => model.value === RECOMMENDED);
  const recommendation = recommended?.resolvedModel ?? recommended?.value;
  // A setting of `default` is the CLI's own word for "whatever is recommended",
  // not a model, so it resolves the same way an absent setting does.
  const wanted = configured === RECOMMENDED ? recommendation : (configured ?? recommendation);
  if (!wanted) return undefined;
  const row = models.find(
    (model) =>
      model.value !== RECOMMENDED && (model.value === wanted || model.resolvedModel === wanted),
  );
  return row?.value ?? wanted;
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

// A catalog entry missing its id or label cannot be selected or shown, so it is
// dropped rather than published as a blank row. A model the CLI gives no effort
// levels for — Haiku — offers none here either, and its rows show no stepper.
function providerModel(model: ClaudeModel, configured: ReasoningEffort | undefined): ModelInfo[] {
  const id = model.value.trim();
  const displayName = versionedDisplayName(model.displayName.trim(), model.description);
  if (!id || !displayName) return [];
  const cliEfforts = (model.supportedEffortLevels ?? []).flatMap((level) => {
    const effort = reasoningValue(level);
    return effort ? [effort] : [];
  });
  // Ultracode is not one of the CLI's levels: it is xhigh plus standing workflow
  // orchestration, so it rides above the published set on the models that can
  // reach xhigh and is absent everywhere else. It is never a starting level, so
  // the default still comes from what the CLI itself publishes.
  const efforts: ReasoningEffort[] = cliEfforts.includes('xhigh')
    ? [...cliEfforts, 'ultra']
    : cliEfforts;
  return [
    {
      id,
      displayName,
      provider: 'anthropic',
      isCustom: false,
      ...(efforts.length > 0
        ? {
            supportedReasoningEfforts: efforts,
            defaultReasoningEffort: defaultEffort(cliEfforts, configured),
          }
        : {}),
    },
  ];
}

// The CLI labels a model by its alias ("Opus") and leads its description with
// the versioned name ("Opus 5 with 1M context · …"); the picker shows the version.
function versionedDisplayName(displayName: string, description: string | undefined): string {
  const match = /^(\S+) (\d+(?:\.\d+)*)\b/.exec(description ?? '');
  if (!match || !displayName.startsWith(match[1]) || /^\S+ \d/.test(displayName))
    return displayName;
  return `${match[1]} ${match[2]}${displayName.slice(match[1].length)}`;
}

// The level a chat on this model starts on: the CLI's own configured effort
// where the model supports it, otherwise the SDK's documented model default.
function defaultEffort(
  efforts: ReasoningEffort[],
  configured: ReasoningEffort | undefined,
): ReasoningEffort {
  if (configured && efforts.includes(configured)) return configured;
  return efforts.includes('high') ? 'high' : efforts[efforts.length - 1];
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
