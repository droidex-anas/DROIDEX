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
import { errMsg } from './errors.js';
import type { SessionLineageStore } from './sessionLineage.js';
import { formatSideChatPrompt } from './sideChatPrompt.js';
import { conversationMarkdown } from './sessionMarkdown.js';
import type { SessionRegistry, SessionSummaryPatch } from './SessionRegistry.js';
import { forkedTranscript, writeForkedTranscript } from './providers/ProviderTranscriptFile.js';
import type { ProviderKind } from './providers/providerKind.js';
import type { Provider, ProviderForkHandle, ProviderModelSettings } from './providers/session.js';

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
  beginForkOpen: (appSessionId: string) => void;
  endForkOpen: (appSessionId: string) => void;
  isCloseRequested: (appSessionId: string) => boolean;
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

// Native copies preserve the provider's full context and resume on their first
// send. Cross-provider branches and streaming sources carry a transcript instead.
export class SessionForks {
  constructor(private readonly d: SessionForksDependencies) {}

  async fork(command: SessionForkCommand): Promise<void> {
    let copy: ProviderForkHandle | undefined;
    try {
      const source = this.forkableSource(command);
      const lineage: SessionLineage = {
        kind: command.lineage,
        sourceAppSessionId: source.appSessionId,
        forkedAt: Date.now(),
      };
      const provider = command.provider ?? source.provider;
      if (provider === source.provider && !this.isStreaming(source)) {
        copy = await this.copyNatively(command, source, lineage);
      } else {
        await this.branchFromTranscript(command, source, provider, lineage);
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
    if (!copy) return;
    try {
      if (this.d.isCloseRequested(copy.providerSessionId)) return;
      if (command.modelId && !(await this.applyPickedModel(copy.providerSessionId, command)))
        return;
      // The renderer can close the announced copy while its model is being applied.
      if (this.d.isCloseRequested(copy.providerSessionId)) return;
      const request = command.prompt?.trim();
      if (request)
        await this.d.send(copy.providerSessionId, firstMessage(command.lineage, request));
    } finally {
      this.d.endForkOpen(copy.providerSessionId);
      // Resume owns a transferred client; failed or unopened copies release it.
      await copy.release?.();
    }
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
  ): Promise<ProviderForkHandle> {
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
    try {
      this.d.beginForkOpen(handle.providerSessionId);
      // Droid writes its copy where its own sessions live. Every other provider's
      // scrollback is DROIDEX's transcript file, which is copied beside it.
      let transcript = null;
      if (source.provider !== 'droid') {
        this.requireUnchanged(source, live);
        const stored = await this.d.readTranscript(source.appSessionId);
        this.requireUnchanged(source, live);
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
          dropContextWindow: changesModel(command, source),
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
      return handle;
    } catch (error) {
      this.d.endForkOpen(handle.providerSessionId);
      await handle.release?.();
      throw error;
    }
  }

  private async branchFromTranscript(
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
  // never had. A relaunch on a new context window keeps the provider session
  // and replaces the runtime, so the runtime itself is compared too, and a
  // turn that started and finished meanwhile moved the chat's activity time.
  private requireUnchanged(source: SessionSummary, runtime: unknown): void {
    const current = this.d.registry.resolveSummary(source.appSessionId);
    if (
      this.d.isShutdownStarted() ||
      current?.providerSessionId !== source.providerSessionId ||
      current?.updatedAt !== source.updatedAt ||
      this.d.registry.getLive(source.appSessionId) !== runtime ||
      this.isStreaming(source)
    ) {
      throw new Error('The chat changed while it was being copied. Try again.');
    }
  }

  // A chat opened this run is indexed only once it closes, so a missing
  // transcript is looked for on disk before the branch gives up.
  private async sourceConversation(source: SessionSummary): Promise<string> {
    // Lines the source's writer still has queued are part of the conversation;
    // the read waits for them. A missing or unreadable file is found out by
    // the stored read below.
    if (source.provider !== 'droid')
      await this.d.readTranscript(source.appSessionId).catch(() => undefined);
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
    ...(!changesModel(command, source) && source.contextWindowTokens !== undefined
      ? { contextWindowTokens: source.contextWindowTokens }
      : {}),
  };
}

// The side chat picker sends the source's own model when it is left alone.
function changesModel(command: SessionForkCommand, source: SessionSummary): boolean {
  return command.modelId !== undefined && command.modelId !== source.modelId;
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
