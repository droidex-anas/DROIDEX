// Converts @factory/droid-sdk stream events into bridge protocol shapes.
import type { DroidStreamEvent, ProgressLogEntry } from '@factory/droid-sdk';
import { convertNotificationToStreamMessage } from '@factory/droid-sdk';
import { bridgeFeature } from './missionFeatures.js';
import { droidErrorDetails } from './providers/droid/droidErrors.js';
import type {
  SessionRole,
  BridgeFeature,
  ChildSpawnLink,
  ModelSwitch,
  ProgressEntry,
  ReasoningEffort,
  TranscriptEvent,
} from '@droidex/protocol';
import { toolResultParts } from './toolResultImages.js';
import { trimmedString as str } from './values.js';
import {
  detectChildSession,
  backgroundTaskCompletion,
  isTaskToolName,
  slimChildSessionArgs,
  taskPrompt,
  taskResultChildUpdate,
  type ChildSessionSignal,
} from './subagentSignals.js';
import { parseSkillActivation, type SkillActivation } from './skillSignals.js';
import { canvasToolProvenance, type ToolProvenance } from './canvas/canvasToolPresentation.js';

let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface NormalizedProgressEntry extends ProgressEntry {
  workerProviderSessionId?: string;
  spawnId?: string;
}

export function mapProgress(entries: ProgressLogEntry[]): NormalizedProgressEntry[] {
  return entries.map((e) => {
    const any = e as Record<string, unknown>;
    const workerProviderSessionId =
      typeof any.workerSessionId === 'string' ? any.workerSessionId : undefined;
    const spawnId = typeof any.spawnId === 'string' ? any.spawnId : undefined;
    return {
      type: typeof any.type === 'string' ? any.type : 'entry',
      timestamp: typeof any.timestamp === 'string' ? any.timestamp : new Date().toISOString(),
      title: typeof any.title === 'string' ? any.title : undefined,
      message:
        typeof any.message === 'string'
          ? any.message
          : typeof any.summary === 'string'
            ? any.summary
            : undefined,
      featureId: typeof any.featureId === 'string' ? any.featureId : undefined,
      ...(workerProviderSessionId ? { workerProviderSessionId } : {}),
      ...(spawnId ? { spawnId } : {}),
    };
  });
}

function transcript(
  appSessionId: string,
  sourceSessionId: string,
  role: SessionRole,
  kind: TranscriptEvent['kind'],
  extra: Partial<TranscriptEvent>,
): TranscriptEvent {
  return { id: nextId(), appSessionId, sourceSessionId, role, ts: Date.now(), kind, ...extra };
}

export interface NormalizedEvent {
  transcript?: TranscriptEvent;
  toolProvenance?: ToolProvenance;
  features?: BridgeFeature[];
  progress?: NormalizedProgressEntry[];
  missionState?: string;
  missionChild?: {
    event: 'started' | 'completed';
    providerSessionId: string;
    exitCode?: number;
  };
  childSession?: ChildSessionSignal;
  // Child rows share the parent's connection. Claude attributes them to their
  // spawn; Codex names the native child thread. Both resolve to a logical child.
  childOwner?: ChildSpawnLink | { kind: 'provider-session'; id: string };
  tokens?: {
    tokensIn: number;
    tokensOut: number;
    contextTokens?: number;
    // The model's context window, for a provider that reports it with usage
    // instead of in its model catalog.
    maxContextTokens?: number;
  };
  // Only ever the primary conversation's own.
  harnessModelSwitch?: HarnessModelSwitch;
  // The name the harness generated for the chat.
  sessionTitle?: string;
  done?: boolean;
}

// A model the harness moved the chat to by itself, with the effort it reported
// for that model when it reported one.
export interface HarnessModelSwitch extends Required<ModelSwitch> {
  reasoningEffort?: ReasoningEffort;
}

function toolUseIdFrom(...values: unknown[]): string | undefined {
  for (const value of values) {
    const id = str(value);
    if (id) return id;
  }
  return undefined;
}

// Translate a single SDK stream event into zero-or-one normalized bridge updates.
export function normalizeStreamEvent(
  appSessionId: string,
  sourceProviderSessionId: string,
  role: SessionRole,
  ev: DroidStreamEvent,
): NormalizedEvent | null {
  const raw = ev as unknown as Record<string, unknown>;
  if (raw.type === 'token_usage_update' || raw.type === 'session_token_usage_changed') {
    const e = raw as Record<string, Record<string, unknown> | undefined>;
    const cumulative = (raw.type === 'session_token_usage_changed' ? e.tokenUsage : e) ?? {};
    // `session_token_usage_changed.tokenUsage` is cumulative for the root
    // session alone; inclusiveTokenUsage adds children and must never become
    // the parent total. It is not the current context window. Some provider
    // versions do not include `lastCallTokenUsage`; in that shape, publish cumulative totals
    // only and let getContextStats() remain authoritative for the meter.
    const context = e.lastCallTokenUsage ?? (raw.type === 'token_usage_update' ? e : undefined);
    // A cumulative frame with no tokenUsage payload carries no information:
    // publishing it would reset the session's accumulated totals to zero.
    if (raw.type === 'session_token_usage_changed' && e.tokenUsage === undefined) return null;
    const tokensIn =
      (Number(cumulative.inputTokens ?? 0) || 0) +
      (Number(cumulative.cacheReadTokens ?? 0) || 0) +
      (Number(cumulative.cacheCreationTokens ?? 0) || 0);
    const tokensOut = Number(cumulative.outputTokens ?? 0) || 0;
    // Mirror the daemon's compaction threshold count (last call's input +
    // output + cacheRead) so the meter measures with the same stick that
    // decides when auto-compaction fires.
    const contextTokens = context
      ? (Number(context.inputTokens ?? 0) || 0) +
        (Number(context.outputTokens ?? 0) || 0) +
        (Number(context.cacheReadTokens ?? 0) || 0)
      : undefined;
    return {
      tokens: {
        tokensIn,
        tokensOut,
        ...(contextTokens === undefined ? {} : { contextTokens }),
      },
    };
  }

  // ToolProgress events nest the spawned subagent's session id under `update`.
  const update =
    raw.update && typeof raw.update === 'object'
      ? (raw.update as Record<string, unknown>)
      : undefined;
  const subagentSessionId = str(raw.subagentSessionId) ?? str(update?.subagentSessionId);
  const eventToolUseId = toolUseIdFrom(raw.toolUseId, update?.toolUseId);

  if (ev.type === 'tool_progress' || raw.type === 'tool_progress') {
    // The session id arrives here; the label was captured earlier on the Task tool_call,
    // so only forward a label if these params actually carry a specific subagent name.
    const params =
      update?.parameters && typeof update.parameters === 'object'
        ? (update.parameters as Record<string, unknown>)
        : {};
    const label = str(params.subagent_type) ?? str(params.subagentType);
    const prompt = taskPrompt(params);
    if (!subagentSessionId && !label && !prompt) return null;
    // Poll-style progress (e.g. TaskOutput's "Reading task output") carries the
    // polling call's tool_use id, not the spawn's. Only spawn-style progress
    // (identified by subagent params) may key the child by that id.
    const isSpawnProgress = Boolean(label ?? prompt);
    return {
      childSession: {
        providerSessionId: subagentSessionId,
        ...(isSpawnProgress && eventToolUseId ? { toolUseId: eventToolUseId } : {}),
        label,
        prompt,
      },
    };
  }

  switch (ev.type) {
    case 'assistant_text_delta':
      return {
        transcript: transcript(appSessionId, sourceProviderSessionId, role, 'text', {
          text: ev.text,
          forkPointId: ev.messageId,
        }),
      };
    case 'thinking_text_delta':
      return {
        transcript: transcript(appSessionId, sourceProviderSessionId, role, 'thinking', {
          text: ev.text,
        }),
      };
    case 'tool_call':
    case 'tool_call_delta': {
      const toolUse =
        (ev as { toolUse?: { id?: string; name?: string; input?: Record<string, unknown> } })
          .toolUse ?? {};
      const toolUseId = toolUseIdFrom(toolUse.id, eventToolUseId);
      if (!toolUseId && !toolUse.name) return null;
      const toolProvenance = canvasToolProvenance(toolUse.name, toolUseId);
      const childSession = detectChildSession(
        toolUse.name,
        toolUse.input ?? {},
        subagentSessionId,
        toolUseId,
      );
      return {
        transcript: transcript(appSessionId, sourceProviderSessionId, role, 'tool_call', {
          toolName: toolUse.name,
          toolArgs: childSession ? slimChildSessionArgs(toolUse.input ?? {}) : toolUse.input,
          // Stamp every tool_call with its stable id so the store/chat feed can
          // collapse the many streaming deltas of one call into a single event
          // (matching the replay path, which derives one block per tool-use).
          ...(toolUseId ? { toolUseId } : {}),
        }),
        ...(toolProvenance ? { toolProvenance } : {}),
        ...(childSession ? { childSession } : {}),
      };
    }
    case 'tool_result': {
      const isTask = isTaskToolName(ev.toolName);
      const toolUseId = toolUseIdFrom((ev as { toolUseId?: string }).toolUseId, eventToolUseId);
      const toolProvenance = canvasToolProvenance(ev.toolName, toolUseId);
      const taskUpdate = ev.isError ? undefined : taskResultChildUpdate(ev.toolName, ev.content);
      const resultProviderSessionId = subagentSessionId ?? taskUpdate?.providerSessionId;
      const resultTranscript = () =>
        transcript(appSessionId, sourceProviderSessionId, role, 'tool_result', {
          toolName: ev.toolName,
          ...toolResultParts(ev.content),
          isError: ev.isError,
          ...(toolUseId ? { toolUseId } : {}),
        });
      // A successful subagent Task result is just the subagent's output, so it
      // surfaces only as a completion signal and never leaks into the main feed.
      // A *failed* spawn must stay visible, so keep its error transcript.
      if (resultProviderSessionId || isTask) {
        const signal = {
          childSession: {
            providerSessionId: resultProviderSessionId,
            // Only a Task tool's own result can be the spawn result; poll and
            // notification results must never rekey the child's spawn link.
            ...(isTask && taskUpdate?.isSpawnResult !== false && toolUseId ? { toolUseId } : {}),
            done: taskUpdate?.done ?? true,
            ...(taskUpdate?.status ? { status: taskUpdate.status } : {}),
            ...(ev.isError && isTask
              ? { status: 'failed' as const, transcriptAvailable: false }
              : {}),
            ...(taskUpdate?.activity ? { activity: taskUpdate.activity } : {}),
          },
        };
        // A non-spawn result that merely *references* a subagent (a TaskOutput
        // poll) keeps its transcript: it carries the child's status signal, and
        // the feed, not the bridge, decides whether the body is worth showing.
        return isTask && !ev.isError ? signal : { ...signal, transcript: resultTranscript() };
      }
      return {
        transcript: resultTranscript(),
        ...(toolProvenance ? { toolProvenance } : {}),
      };
    }
    case 'error': {
      const details = droidErrorDetails(ev.message);
      return {
        transcript: transcript(appSessionId, sourceProviderSessionId, role, 'error', {
          ...details,
          ...(eventToolUseId ? { toolUseId: eventToolUseId } : {}),
        }),
      };
    }
    case 'mission_features_changed':
      return { features: ev.features.map(bridgeFeature) };
    case 'mission_progress_entry':
      return { progress: mapProgress(ev.progressLog) };
    case 'mission_state_changed':
      return { missionState: ev.state };
    case 'mission_worker_started':
      return {
        missionChild: { event: 'started', providerSessionId: ev.workerSessionId },
      };
    case 'mission_worker_completed':
      return {
        missionChild: {
          event: 'completed',
          providerSessionId: ev.workerSessionId,
          exitCode: ev.exitCode,
        },
      };
    case 'result':
      return { done: true };
    default:
      if (subagentSessionId)
        return {
          childSession: {
            providerSessionId: subagentSessionId,
            toolUseId: eventToolUseId,
          },
        };
      return null;
  }
}

// Daemon auto-compaction runs in place (same session id) and announces itself
// only through raw notifications: a `droid_working_state_changed` to
// `compacting_conversation` when it starts and a `session_compacted` when it
// finishes. Neither survives convertNotificationToStreamMessage as a usable
// stream event, so callers detect them here before the generic conversion.
export interface CompactionNotification {
  kind: 'started' | 'completed';
  removedCount: number;
  summaryId?: string;
}

export function extractCompactionNotification(
  notification: Record<string, unknown>,
): CompactionNotification | null {
  const raw = extractNotification(notification);
  if (!raw || typeof raw !== 'object') return null;
  const note = raw as Record<string, unknown>;
  if (note.type === 'droid_working_state_changed' && note.newState === 'compacting_conversation')
    return { kind: 'started', removedCount: 0 };
  if (note.type === 'session_compacted') {
    const summaryId = typeof note.summaryId === 'string' ? note.summaryId : undefined;
    return {
      kind: 'completed',
      removedCount: Number(note.removedCount ?? 0) || 0,
      ...(summaryId ? { summaryId } : {}),
    };
  }
  return null;
}

export function normalizeNotification(
  appSessionId: string,
  sourceProviderSessionId: string,
  role: SessionRole,
  notification: Record<string, unknown>,
): NormalizedEvent[] {
  const raw = extractNotification(notification);
  const startedChild = childSessionAvailableFrom(raw);
  if (startedChild) return [{ childSession: startedChild }];
  const backgroundTask = backgroundTaskCompletionFrom(raw);
  if (backgroundTask)
    return [
      {
        childSession: {
          providerSessionId: backgroundTask.providerSessionId,
          done: true,
          status: backgroundTask.status,
        },
      },
    ];
  const sessionTitle = sessionTitleFrom(raw);
  if (sessionTitle) return [{ sessionTitle }];
  const skillActivation = skillActivationFromNotification(raw);
  if (skillActivation)
    return [
      {
        transcript: transcript(appSessionId, sourceProviderSessionId, role, 'text', {
          text: skillActivation.message,
        }),
      },
    ];
  const converted = convertNotificationToStreamMessage(raw);
  const messages = Array.isArray(converted) ? converted : converted ? [converted] : [];
  return messages
    .map((message) =>
      normalizeStreamEvent(
        appSessionId,
        sourceProviderSessionId,
        role,
        message as DroidStreamEvent,
      ),
    )
    .filter((event): event is NormalizedEvent => event !== null);
}

function sessionTitleFrom(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const notification = raw as Record<string, unknown>;
  if (notification.type !== 'session_title_updated') return undefined;
  return str(notification.title);
}

function skillActivationFromNotification(raw: unknown): SkillActivation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const notification = raw as Record<string, unknown>;
  if (notification.type !== 'create_message') return undefined;
  const message = notification.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const record = message as Record<string, unknown>;
  if (record.role !== 'user' || record.visibility !== 'user_only') return undefined;
  const content = record.content;
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block: unknown = content[0];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined;
  const text = (block as Record<string, unknown>).text;
  return typeof text === 'string' ? parseSkillActivation(text) : undefined;
}

// The Droid CLI announces a Task subagent's own session as soon as it starts.
// Without it the child is only known from the Task result, after it finished.
function childSessionAvailableFrom(raw: unknown): ChildSessionSignal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const notification = raw as Record<string, unknown>;
  if (notification.type !== 'child_session_available') return undefined;
  const providerSessionId = str(notification.childSessionId);
  if (!providerSessionId) return undefined;
  const toolUseId = str(notification.toolUseId);
  const label = str(notification.subagentType) ?? str(notification.description);
  return {
    providerSessionId,
    ...(toolUseId ? { toolUseId } : {}),
    ...(label ? { label } : {}),
  };
}

function backgroundTaskCompletionFrom(raw: unknown): ReturnType<typeof backgroundTaskCompletion> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const notification = raw as Record<string, unknown>;
  if (notification.type !== 'create_message') return undefined;
  const message = notification.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        !!block &&
        typeof block === 'object' &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === 'text' &&
        typeof (block as Record<string, unknown>).text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
  return backgroundTaskCompletion(text);
}

export function extractNotification(notification: Record<string, unknown>): unknown {
  const params =
    notification.params &&
    typeof notification.params === 'object' &&
    !Array.isArray(notification.params)
      ? (notification.params as Record<string, unknown>)
      : undefined;
  if (params && 'notification' in params) return params.notification;
  if ('notification' in notification) return notification.notification;
  return notification;
}
