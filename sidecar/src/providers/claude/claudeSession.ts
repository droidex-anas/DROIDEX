// One Claude Code process per DROIDEX session, driven through the agent SDK's
// streaming-input mode: the prompt is a live async iterable, so turns reuse the
// same process and the permission mode and model can change while it runs.
import {
  query,
  type EffortLevel,
  type McpServerConfig,
  type ModelInfo,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy, ReasoningEffort, SessionInteractionMode } from '../../protocol.js';
import { errMsg } from '../../sessionHelpers.js';
import type { SkillInfo } from '../catalog.js';
import type { ProviderInteractions } from '../interactions.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import { claudeContextEnv, claudeContextModel } from './claudeContextWindow.js';
import { ClaudeCatalog } from './claudeCatalog.js';
import { ClaudeEventMapper, rateLimitRefusal } from './claudeEvents.js';
import { MessageQueue } from './claudeMessages.js';
import { claudeCanUseTool, claudePermissionMode } from './claudePermissions.js';

export interface ClaudeSessionInput {
  // Claude pins the session id it is given, so DROIDEX's own identity is also
  // the provider's: there is no separate resume handle.
  appSessionId: string;
  executable: string;
  cwd: string;
  autonomy: Autonomy;
  interactionMode: SessionInteractionMode;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  contextWindowTokens?: 200000 | 1000000;
  models: ModelInfo[];
  mcpServers: Record<string, McpServerConfig>;
  interactions: ProviderInteractions;
  // Set when reopening a stored session instead of starting a new one.
  resume?: boolean;
}

export class ClaudeSession implements ProviderSession {
  readonly provider = 'claude' as const;
  readonly providerSessionId: string;
  readonly closed: Promise<Error | undefined>;

  private readonly abort = new AbortController();
  private resolveClosed: (error?: Error) => void = () => undefined;
  private failure?: Error;
  private readonly prompts = new MessageQueue<SDKUserMessage>();
  private readonly mapper: ClaudeEventMapper;
  private readonly query: Query;
  // Turns can stream during boot, but control requests must wait: the SDK
  // writes them immediately, before the CLI has answered initialize.
  private readonly initialized: Promise<void>;
  private readonly catalog: ClaudeCatalog;
  // Resolves once the CLI process exists, which is all an open has to wait for.
  private readonly spawned: Promise<void>;
  private initializing = true;
  private child?: ChildProcess;
  private autonomy: Autonomy;
  private modelId: string | undefined;
  // Spec mode is Claude Code's plan mode, and both reach the CLI as the one
  // permission mode, so the session owns which of the two is in force.
  private planning: boolean;
  // Serializes the permission-mode changes below, so two never race.
  private modeChanges: Promise<void> = Promise.resolve();
  private activeTurnId?: string;
  // The turn the user stopped, so only that turn's own error result is excused.
  private interruptedTurnId?: string;
  private turnQueue?: MessageQueue<{ message: SDKMessage; events: NormalizedEvent[] }>;
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();

  constructor(private readonly input: ClaudeSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.autonomy = input.autonomy;
    this.modelId = input.modelId;
    this.planning = input.interactionMode === 'spec';
    this.mapper = new ClaudeEventMapper(input.appSessionId, input.modelId);
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    let markSpawned = (): void => undefined;
    let rejectSpawn: (error: Error) => void = () => undefined;
    const spawned = new Promise<void>((resolve, reject) => {
      markSpawned = resolve;
      rejectSpawn = reject;
    });
    this.query = query({
      prompt: this.prompts,
      options: sessionOptions(
        input,
        this.abort,
        () => this.planning,
        (process) => {
          this.child = process;
          process.once('spawn', markSpawned);
          process.once('error', (error) => {
            rejectSpawn(error);
            this.childClosed(error);
          });
          const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
            let error: Error | undefined;
            if (signal) error = new Error(`Session process was killed (${signal}).`);
            else if (code !== 0)
              error = new Error(`Session process exited with code ${String(code)}.`);
            this.childClosed(error);
          };
          process.once('exit', onExit);
          process.once('close', onExit);
        },
      ),
    });
    this.initialized = this.query.initializationResult().then(
      () => {
        this.abort.signal.throwIfAborted();
        this.initializing = false;
      },
      (error: unknown) => {
        this.abort.signal.throwIfAborted();
        this.initializing = false;
        const failure = new Error(errMsg(error));
        this.finish(failure);
        throw failure;
      },
    );
    // Startup can fail before a turn observes it. The turn or the lifecycle's
    // closure observer reports the failure without an unhandled rejection.
    void this.initialized.catch(() => undefined);
    this.catalog = new ClaudeCatalog(this.query, this.initialized);
    // A CLI that fails before it reaches spawn still settles initialization,
    // which is what releases the open instead of leaving it hanging.
    this.spawned = Promise.race([spawned, this.initialized]);
    void this.pump();
  }

  // Returns as soon as the CLI process exists, so the session reaches the
  // lifecycle with a pid to track while the CLI is still booting behind it.
  async start(): Promise<void> {
    await this.spawned;
  }

  onBackgroundEvent(listener: (event: NormalizedEvent) => void): () => void {
    this.backgroundListeners.add(listener);
    return () => {
      this.backgroundListeners.delete(listener);
    };
  }

  get isClosed(): boolean {
    return this.abort.signal.aborted;
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const child = this.child;
    const pid = child?.pid;
    if (child === undefined || pid === undefined) return undefined;
    return { pid, isAlive: () => child.exitCode === null && !child.killed };
  }

  catalogItems(): Promise<SkillInfo[]> {
    return this.catalog.catalogItems();
  }

  onCatalogUpdated(listener: (items: SkillInfo[]) => void): () => void {
    return this.catalog.onUpdated(listener);
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.activeTurnId) throw new Error('This Claude session is already running a turn.');
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.mapper.beginTurn();
    const turnQueue = (this.turnQueue = new MessageQueue<{
      message: SDKMessage;
      events: NormalizedEvent[];
    }>());
    let reportedPlanningModel = false;
    try {
      this.requireOpen();
      this.prompts.push({
        type: 'user',
        uuid: turnId,
        session_id: this.providerSessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt },
      });
      for (;;) {
        const next = await turnQueue.next();
        // An exhausted stream is a failure, not a silent success.
        if (next.done) throw new Error('Claude Code exited before the turn finished.');
        const { message, events } = next.value;
        if (message.type === 'assistant' && !reportedPlanningModel) {
          const notice = this.planningModelNotice(message);
          if (notice) {
            reportedPlanningModel = true;
            yield this.mapper.statusEvent(notice);
          }
        }
        yield* events;
        // A local slash command bypasses the model loop and publishes this one
        // terminal frame instead of a result for the ordinary turn path.
        if (message.type === 'system' && message.subtype === 'local_command_output') {
          yield { done: true };
          return;
        }
        // A refused usage window is answered with no result at all, so the turn
        // has to end here instead of waiting for one that never comes.
        if (message.type === 'rate_limit_event') {
          const refusal = rateLimitRefusal(message.rate_limit_info);
          if (refusal) throw refusal;
        }
        if (message.type === 'result' && answersTurn(message, turnId)) {
          // A stopped turn settles quietly: the CLI still reports the
          // interruption as an error result carrying an internal diagnostic.
          if (message.subtype !== 'success' && this.interruptedTurnId !== turnId)
            throw new Error(turnFailure(message.subtype, message.errors));
          yield { done: true };
          return;
        }
      }
    } finally {
      this.activeTurnId = undefined;
      if (this.turnQueue === turnQueue) this.turnQueue = undefined;
    }
  }

  private planningModelNotice(
    message: Extract<SDKMessage, { type: 'assistant' }>,
  ): string | undefined {
    const model = message.message.model;
    if (
      !this.planning ||
      !this.modelId ||
      message.parent_tool_use_id ||
      model === '<synthetic>' ||
      matchesModel(this.modelId, model)
    )
      return undefined;
    // Plan mode can override the pin inside the CLI; report its choice without changing it.
    return `Planning on ${model}, Claude Code's plan-mode model.`;
  }

  // Keep reading between turns so background children can settle immediately.
  private async pump(): Promise<void> {
    try {
      for (;;) {
        this.requireOpen();
        const next = this.query.next().catch((error: unknown) => {
          // Closing the iterator may race the initialization failure that caused it.
          this.requireOpen();
          throw error;
        });
        // Observe both promises even when closing the query settles its
        // iterator first, so a boot failure surfaces instead of hanging here.
        if (this.initializing) await Promise.race([this.initialized, next]);
        const result = await next;
        this.requireOpen();
        if (result.done) {
          throw new Error('Claude Code exited before the turn finished.');
        }
        this.dispatch(result.value);
      }
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(errMsg(error)));
    }
  }

  private dispatch(message: SDKMessage): void {
    this.catalog.observe(message);
    // Mapping stays in wire order, including model and spawn-link observations.
    const events = this.mapper.map(message);
    const turnEvents: NormalizedEvent[] = [];
    for (const event of events) {
      if (event.childSession) {
        for (const listener of this.backgroundListeners) listener(event);
      } else turnEvents.push(event);
    }
    this.turnQueue?.push({ message, events: turnEvents });
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.changePermissionMode(() => ({ autonomy, planning: this.planning }));
  }

  // Spec mode is plan mode: the model plans and reads, and its ExitPlanMode call
  // raises the plan for review rather than ending the mode itself.
  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    await this.changePermissionMode(() => ({ autonomy: this.autonomy, planning: mode === 'spec' }));
  }

  // Autonomy and Spec reach the CLI as the one permission mode, so changes run
  // one at a time and each reads the session as it is when its turn comes: two
  // that overlap can no longer send a mode built from state the other replaced.
  // The session commits only what the CLI accepted.
  private changePermissionMode(
    next: () => { autonomy: Autonomy; planning: boolean },
  ): Promise<void> {
    const applied = this.modeChanges.then(async () => {
      await this.waitUntilInitialized();
      const { autonomy, planning } = next();
      // While the session is planning the permission mode is already plan mode
      // and stays it, so a new autonomy is only recorded here and takes effect
      // when the session leaves Spec.
      if (!planning || !this.planning)
        await this.query.setPermissionMode(planning ? 'plan' : claudePermissionMode(autonomy));
      this.abort.signal.throwIfAborted();
      this.autonomy = autonomy;
      this.planning = planning;
    });
    // A refused change settles its own caller; the next one still gets its turn.
    this.modeChanges = applied.catch(() => undefined);
    return applied;
  }

  // Model and effort stay on this process, never in the user's settings files.
  // Replaying an already-applied model needs no API validation request.
  async setModel({
    modelId,
    reasoningEffort,
    contextWindowTokens,
  }: ProviderModelSettings): Promise<void> {
    await this.waitUntilInitialized();
    const resolvedModel = claudeContextModel(
      modelId === undefined ? this.modelId : (modelId ?? undefined),
      contextWindowTokens ?? this.input.contextWindowTokens,
      this.input.models,
    );
    if (modelId !== undefined && resolvedModel !== this.modelId) {
      await this.query.setModel(resolvedModel);
      this.requireOpen();
      this.modelId = resolvedModel;
      this.mapper.setModel(this.modelId);
    }
    this.abort.signal.throwIfAborted();
    // Leaving ultra clears the flag instead of writing `false`, which is what
    // turns ultracode off while keeping the level chosen alongside it. A model
    // without levels clears both, so the previous model's do not follow it.
    if (reasoningEffort === null)
      await this.query.applyFlagSettings({ effortLevel: null, ultracode: null });
    const effort = claudeEffort(reasoningEffort ?? undefined);
    if (effort)
      await this.query.applyFlagSettings({
        effortLevel: effort.effortLevel,
        ultracode: effort.ultracode ? true : null,
      });
  }

  private requireOpen(): void {
    if (this.failure) throw this.failure;
    this.abort.signal.throwIfAborted();
  }

  private async waitUntilInitialized(): Promise<void> {
    this.requireOpen();
    await this.initialized;
    this.requireOpen();
  }

  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    // A second Stop during boot releases a CLI that never initializes.
    if (this.initializing && this.interruptedTurnId === turnId) {
      await this.close();
      return;
    }
    this.interruptedTurnId = turnId;
    try {
      await this.initialized;
    } catch {
      // The turn or closure observer owns startup failure diagnostics.
      return;
    }
    if (this.abort.signal.aborted || this.activeTurnId !== turnId) return;
    // Aborts the in-flight turn on the live process; the turn then settles with
    // its own result, so the next prompt does not pay for a restart.
    await this.query.interrupt();
  }

  close(): Promise<void> {
    this.finish();
    return Promise.resolve();
  }

  private childClosed(error?: Error): void {
    if (this.abort.signal.aborted) return;
    if (!this.initializing) {
      this.finish(error);
      return;
    }
    // Initialization owns the startup diagnostic, even if exit arrives first.
    void this.initialized.then(
      () => {
        this.finish(error);
      },
      () => undefined,
    );
  }

  private finish(error?: Error): void {
    if (this.abort.signal.aborted) return;
    this.failure = error;
    this.abort.abort();
    this.catalog.close();
    this.prompts.close();
    this.turnQueue?.close(error);
    this.backgroundListeners.clear();
    // The SDK closes stdin and escalates SIGTERM to SIGKILL itself.
    try {
      this.query.close();
    } finally {
      this.resolveClosed(error);
    }
  }
}

function sessionOptions(
  input: ClaudeSessionInput,
  abortController: AbortController,
  isPlanning: () => boolean,
  onSpawn: (process: ChildProcess) => void,
): Options {
  const effort = claudeEffort(input.reasoningEffort);
  return {
    abortController,
    cwd: input.cwd,
    pathToClaudeCodeExecutable: input.executable,
    ...(input.modelId ? { model: input.modelId } : {}),
    // The flag is written both ways: a settings file may carry ultracode too,
    // and the level the chip shows is the one the session must run at.
    ...(effort ? { effort: effort.effortLevel, settings: { ultracode: effort.ultracode } } : {}),
    ...(input.resume ? { resume: input.appSessionId } : { sessionId: input.appSessionId }),
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // 'project' is what loads the repository's CLAUDE.md.
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    mcpServers: input.mcpServers,
    // The Spec toggle owns plan mode, so the model may not enter it on its own:
    // at high autonomy bypassPermissions skips canUseTool altogether and a
    // refusal there would never run. ExitPlanMode stays available because it is
    // how the model hands its plan over, and plan mode always asks the callback.
    disallowedTools: ['EnterPlanMode'],
    permissionMode:
      input.interactionMode === 'spec' ? 'plan' : claudePermissionMode(input.autonomy),
    // Consent to the bypass mode, not the mode itself: the CLI reads this flag
    // only as "this host may use bypassPermissions" and takes the mode from
    // permissionMode. Raising autonomy to high mid-session switches the mode
    // with setPermissionMode, which the CLI refuses without this.
    allowDangerouslySkipPermissions: true,
    canUseTool: claudeCanUseTool(input.appSessionId, input.interactions, isPlanning),
    // The SDK would otherwise own the subprocess privately; spawning it here is
    // what gives the session a pid for the agent-process monitor to track and
    // kill, the way it tracks Droid's.
    spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
      const child = spawn(command, args, {
        ...(cwd !== undefined ? { cwd } : {}),
        env: claudeContextEnv(env, input.contextWindowTokens),
        signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      // Nothing else reads stderr on this path, and a full pipe would stall the
      // CLI mid-turn.
      child.stderr.resume();
      onSpawn(child);
      return child;
    },
    // HOME is never overridden: on macOS it also relocates the login keychain,
    // and the CLI then reports the user as signed out.
  };
}

// DROIDEX's effort vocabulary is the union of every harness's; Claude Code
// takes the five levels it publishes and nothing else, so a level from another
// harness leaves the session on its own default rather than being coerced.
const CLAUDE_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Ultra is the CLI's ultracode: xhigh effort plus standing workflow
// orchestration, carried as a session setting rather than a sixth level.
interface ClaudeEffort {
  effortLevel: EffortLevel;
  ultracode: boolean;
}

function claudeEffort(effort: ReasoningEffort | undefined): ClaudeEffort | undefined {
  if (effort === 'ultra') return { effortLevel: 'xhigh', ultracode: true };
  const level = CLAUDE_EFFORTS.find((candidate) => candidate === effort);
  return level ? { effortLevel: level, ultracode: false } : undefined;
}

function matchesModel(selected: string, actual: string): boolean {
  const model = selected.replace(/\[1m\]$/i, '');
  if (model === actual) return true;
  // The picker also publishes CLI aliases, while assistant frames carry wire ids.
  return !model.startsWith('claude-') && actual.startsWith(`claude-${model}-`);
}

function turnFailure(subtype: string, errors: string[]): string {
  // The CLI's own diagnostics are bracketed internals; the subtype is what a
  // user can act on.
  const detail = errors.filter((error) => !error.startsWith('[')).join('\n');
  return detail
    ? `Claude Code ended the turn (${subtype}): ${detail}`
    : `Claude Code ended the turn (${subtype}).`;
}

function answersTurn(
  message: { user_message_uuid?: string; user_message_uuids?: string[] },
  turnId: string,
): boolean {
  // The plural list names every prompt the turn has consumed, so where it
  // exists it is the whole answer: a result that omits this turn's uuid belongs
  // to another turn, whatever the singular field says.
  if (message.user_message_uuids) return message.user_message_uuids.includes(turnId);
  if (message.user_message_uuid !== undefined) return message.user_message_uuid === turnId;
  // Older CLIs stamp neither field; their result can only be this turn's.
  return true;
}
