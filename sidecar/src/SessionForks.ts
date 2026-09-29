import { formatBranchPrompt } from './branchPrompt.js';
import { loadSessionTranscriptWindow, resolveSessionChain } from './history.js';
import type {
  ClientCommand,
  ServerEvent,
  SessionLineage,
  SessionSummary,
  TranscriptEvent,
} from './protocol.js';
import type { LiveSession, SessionBranch, SessionCreateCommand } from './SessionLifecycle.js';
import type { SessionFileChange } from './sessionFileCache.js';
import { errMsg } from './sessionHelpers.js';
import type { SessionLineageStore } from './sessionLineage.js';
import { formatSideChatPrompt } from './sideChatPrompt.js';
import { conversationMarkdown } from './sessionMarkdown.js';
import type { SessionRegistry, SessionSummaryPatch } from './SessionRegistry.js';
import { forkedTranscript, writeForkedTranscript } from './providers/ProviderTranscriptFile.js';
import type { ProviderKind } from './providers/providerKind.js';
import type { Provider, ProviderModelSettings } from './providers/session.js';

type SessionForkCommand = Extract<ClientCommand, { type: 'session.fork' }>;

// Enough of a long chat to carry it into another harness; the branch prompt
// caps the Markdown again by characters.
const BRANCH_CONTEXT_EVENTS = 2_000;

export interface SessionForksDependencies {
  provider: (kind: ProviderKind) => Provider;
  registry: Pick<
    SessionRegistry<LiveSession>,
    'getLive' | 'resolveSummary' | 'updateStoredSummary'
  >;
  lineage: SessionLineageStore;
  // Indexes one session file now, or scans for every file when given null.
  indexSessionFiles: (change: SessionFileChange | null) => Promise<void>;
  // A session's DROIDEX transcript, behind every line its writer has queued.
  readTranscript: (appSessionId: string) => Promise<string>;
  // The settings owner's model change: it reaches the provider as well as the stored row.
  updateModel: (appSessionId: string, settings: ProviderModelSettings) => Promise<boolean>;
  isShutdownStarted: () => boolean;
  create: (command: SessionCreateCommand, branch: SessionBranch) => Promise<void>;
  send: (appSessionId: string, text: string) => Promise<void>;
  emit: (event: ServerEvent) => void;
  emitError: (error: {
    code: string;
    clientRef?: string;
    appSessionId?: string;
    message: string;
  }) => void;
}

// Copies a session into a new one. On the source's own provider the provider
// copies its conversation and the copy is stored closed, to be resumed by its
// first send. Another provider cannot read that conversation, and a turn in
// progress cannot be copied, so then the copy is a new session whose first
// prompt carries the source transcript. Either way a `prompt` is the copy's
// first message.
export class SessionForks {
  constructor(private readonly d: SessionForksDependencies) {}

  async fork(command: SessionForkCommand): Promise<void> {
    let copiedAppSessionId: string | undefined;
    try {
      const source = this.forkableSource(command);
      const lineage: SessionLineage = {
        kind: command.lineage,
        sourceAppSessionId: source.appSessionId,
        forkedAt: Date.now(),
      };
      const provider = command.provider ?? source.provider;
      if (provider === source.provider && !this.isStreaming(source)) {
        copiedAppSessionId = await this.copyNatively(command, source, lineage);
      } else {
        await this.branchAcross(command, source, provider, lineage);
      }
    } catch (error) {
      this.d.emitError({
        code: 'session.create_failed',
        clientRef: command.clientRef,
        message: errMsg(error),
      });
      return;
    }
    // Outside the fork's own failure path: the copy exists by now, so a model
    // or a send that fails is that chat's error, not a failed fork.
    if (!copiedAppSessionId) return;
    if (command.modelId && !(await this.applyPickedModel(copiedAppSessionId, command))) return;
    const request = command.prompt?.trim();
    if (request) await this.d.send(copiedAppSessionId, firstMessage(command.lineage, request));
  }

  // A model picked for the copy replaces the source's and its effort, since an
  // effort only means something for the model it was chosen with.
  private async applyPickedModel(
    appSessionId: string,
    command: SessionForkCommand,
  ): Promise<boolean> {
    try {
      return await this.d.updateModel(appSessionId, {
        modelId: command.modelId,
        reasoningEffort: command.reasoningEffort ?? null,
      });
    } catch (error) {
      this.d.emitError({
        code: 'session.settings_failed',
        appSessionId,
        message: `Could not switch the copied chat's model: ${errMsg(error)}`,
      });
      return false;
    }
  }

  // A turn in progress has no settled copy yet: the provider would copy half
  // an answer. A fork waits for it; a side chat is asked about the work while
  // it runs, so it branches from the settled transcript instead of copying.
  private forkableSource(command: SessionForkCommand): SessionSummary {
    const source = this.d.registry.resolveSummary(command.appSessionId);
    if (!source) throw new Error('This chat is no longer available to fork.');
    if (source.sessionPurpose === 'mission-control') {
      throw new Error('Missions cannot be forked.');
    }
    if (command.lineage === 'fork' && this.isStreaming(source)) {
      throw new Error('Wait for the current turn to finish before forking this chat.');
    }
    return source;
  }

  private isStreaming(source: SessionSummary): boolean {
    return this.d.registry.getLive(source.appSessionId)?.summary.streaming === true;
  }

  private async copyNatively(
    command: SessionForkCommand,
    source: SessionSummary,
    lineage: SessionLineage,
  ): Promise<string> {
    const live = this.d.registry.getLive(source.appSessionId);
    const handle = await this.d.provider(source.provider).fork({
      providerSessionId: source.providerSessionId ?? source.appSessionId,
      ...(source.resumeId ? { resumeId: source.resumeId } : {}),
      ...(source.compactedFromProviderSessionIds
        ? { compactedFromProviderSessionIds: source.compactedFromProviderSessionIds }
        : {}),
      ...(source.cwd ? { cwd: source.cwd } : {}),
      title: command.title,
      ...(live ? { live: live.session } : {}),
      ...(command.forkPointId ? { forkPointId: command.forkPointId } : {}),
    });
    // Droid writes its copy where its own sessions live. Every other provider's
    // scrollback is DROIDEX's transcript file, which is copied beside it.
    let transcript = null;
    if (source.provider !== 'droid') {
      this.requireUnchanged(source);
      const stored = await this.d.readTranscript(source.appSessionId);
      this.requireUnchanged(source);
      transcript = forkedTranscript(source.appSessionId, stored, command.forkPointId);
    }
    const appSessionId = handle.providerSessionId;
    const change = transcript && {
      providerSessionId: appSessionId,
      path: await writeForkedTranscript(transcript, {
        appSessionId,
        title: command.title,
        ...(handle.resumeId ? { resumeId: handle.resumeId } : {}),
        ...(handle.forkPointRenames ? { forkPointRenames: handle.forkPointRenames } : {}),
        dropContextWindow: command.modelId !== undefined,
      }),
    };
    // Recorded before the copy is indexed, so the list that indexing publishes
    // already keeps a side chat out of the sidebar.
    this.d.lineage.record(appSessionId, lineage);
    await this.d.indexSessionFiles(change);
    // The stored row makes the copy a DROIDEX chat and carries the source's
    // settings, which the provider's file does not always hold.
    const stored = await this.d.registry.updateStoredSummary(
      appSessionId,
      copiedSettings(command, source),
    );
    const session = stored && this.d.registry.resolveSummary(appSessionId);
    if (!session) throw new Error('The copied chat could not be found after forking.');
    this.d.emit({ type: 'session.forked', clientRef: command.clientRef, session });
    return appSessionId;
  }

  private async branchAcross(
    command: SessionForkCommand,
    source: SessionSummary,
    provider: ProviderKind,
    lineage: SessionLineage,
  ): Promise<void> {
    const request = command.prompt?.trim();
    if (!request) throw new Error('A chat branched from a transcript needs a first message.');
    await this.d.create(
      {
        type: 'session.create',
        clientRef: command.clientRef,
        ...(source.cwd ? { cwd: source.cwd } : {}),
        title: command.title,
        goal: request,
        sessionPurpose: 'chat',
        provider,
        interactionMode: source.interactionMode === 'spec' ? 'spec' : 'auto',
        autonomy: source.autonomy,
        ...(provider === source.provider
          ? { ...modelSettings(command, source), ...chatPreferences(command, source) }
          : pickedModelSettings(command)),
      },
      {
        lineage,
        prompt: formatBranchPrompt(
          firstMessage(command.lineage, request),
          await this.sourceConversation(source),
        ),
      },
    );
  }

  // The provider's copy was taken across an await: a source that closed, was
  // replaced or started a turn meanwhile would pair it with a transcript it
  // never had.
  private requireUnchanged(source: SessionSummary): void {
    const current = this.d.registry.resolveSummary(source.appSessionId);
    if (
      this.d.isShutdownStarted() ||
      current?.providerSessionId !== source.providerSessionId ||
      this.isStreaming(source)
    ) {
      throw new Error('The chat changed while it was being copied. Try again.');
    }
  }

  // A chat opened this run is indexed only once it closes, so a missing
  // transcript is looked for on disk before the branch gives up.
  private async sourceConversation(source: SessionSummary): Promise<string> {
    let events = storedEvents(source);
    if (events.length === 0) {
      await this.d.indexSessionFiles(null);
      events = storedEvents(source);
    }
    if (events.length === 0) throw new Error('This chat has no stored messages to fork.');
    return conversationMarkdown(events);
  }
}

function firstMessage(lineage: SessionLineage['kind'], request: string): string {
  return lineage === 'side' ? formatSideChatPrompt(request) : request;
}

function copiedSettings(command: SessionForkCommand, source: SessionSummary): SessionSummaryPatch {
  return {
    title: command.title,
    goal: source.goal,
    cwd: source.cwd,
    autonomy: source.autonomy,
    interactionMode: source.interactionMode,
    ...(source.workspaceKind ? { workspaceKind: source.workspaceKind } : {}),
    // A picked model is applied through the settings owner once the copy exists.
    ...(command.modelId ? {} : modelSettings(command, source)),
    ...chatPreferences(command, source),
    ...(source.compactionModel ? { compactionModel: source.compactionModel } : {}),
  };
}

// A model picked for the copy replaces the source's model and its effort,
// since an effort only means something for the model it was chosen with.
function modelSettings(command: SessionForkCommand, source: SessionSummary): SessionSummaryPatch {
  if (command.modelId) return pickedModelSettings(command);
  return {
    ...(source.modelId ? { modelId: source.modelId } : {}),
    ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
  };
}

// The fast mode the chat asked for stays with a copy on the same harness, as
// the copied transcript and settings files already say. Its window belongs to
// its model, like an effort: a model picked for the copy runs its own default,
// since it may have no 1M version at all.
function chatPreferences(command: SessionForkCommand, source: SessionSummary): SessionSummaryPatch {
  return {
    ...(source.fastMode !== undefined ? { fastMode: source.fastMode } : {}),
    ...(!command.modelId && source.contextWindowTokens !== undefined
      ? { contextWindowTokens: source.contextWindowTokens }
      : {}),
  };
}

// Another harness cannot run the source's model; without a pick it starts on its own default.
function pickedModelSettings(command: SessionForkCommand): SessionSummaryPatch {
  return {
    ...(command.modelId ? { modelId: command.modelId } : {}),
    ...(command.reasoningEffort ? { reasoningEffort: command.reasoningEffort } : {}),
  };
}

function storedEvents(source: SessionSummary): TranscriptEvent[] {
  const providerSessionId = source.providerSessionId ?? source.appSessionId;
  const chain = resolveSessionChain(source.appSessionId, providerSessionId);
  return loadSessionTranscriptWindow(source.appSessionId, chain, { limit: BRANCH_CONTEXT_EVENTS })
    .events;
}
