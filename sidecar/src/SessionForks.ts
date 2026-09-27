import { formatBranchPrompt } from './branchPrompt.js';
import { loadSessionTranscriptWindow, resolveSessionChain } from './history.js';
import type { ClientCommand, ServerEvent, SessionLineage, SessionSummary } from './protocol.js';
import type { LiveSession, SessionBranch, SessionCreateCommand } from './SessionLifecycle.js';
import type { SessionFileChange } from './sessionFileCache.js';
import { errMsg } from './sessionHelpers.js';
import type { SessionLineageStore } from './sessionLineage.js';
import { conversationMarkdown } from './sessionMarkdown.js';
import type { SessionRegistry, SessionSummaryPatch } from './SessionRegistry.js';
import { readForkedTranscript, writeForkedTranscript } from './providers/ProviderTranscriptFile.js';
import type { ProviderKind } from './providers/providerKind.js';
import type { Provider } from './providers/session.js';

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
  admitCopiedSession: (change: SessionFileChange | null) => Promise<void>;
  create: (command: SessionCreateCommand, branch: SessionBranch) => Promise<void>;
  send: (appSessionId: string, text: string) => Promise<void>;
  emit: (event: ServerEvent) => void;
  emitError: (error: { code: string; clientRef: string; message: string }) => void;
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
    // Outside the fork's own failure path: the copy exists by now, so a send
    // that fails is that chat's send error, not a failed fork.
    const request = command.prompt?.trim();
    if (copiedAppSessionId && request) await this.d.send(copiedAppSessionId, request);
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
    // Droid writes its copy where its own sessions live. Every other provider's
    // scrollback is DROIDEX's transcript file, which is copied beside it.
    const transcript =
      source.provider === 'droid'
        ? null
        : readForkedTranscript(source.appSessionId, command.forkPointId);
    const handle = await this.d.provider(source.provider).fork({
      providerSessionId: source.providerSessionId ?? source.appSessionId,
      ...(source.resumeId ? { resumeId: source.resumeId } : {}),
      ...(source.cwd ? { cwd: source.cwd } : {}),
      title: command.title,
      ...(live ? { live: live.session } : {}),
      ...(command.forkPointId ? { forkPointId: command.forkPointId } : {}),
    });
    const appSessionId = handle.providerSessionId;
    const change = transcript && {
      providerSessionId: appSessionId,
      path: writeForkedTranscript(transcript, {
        appSessionId,
        title: command.title,
        ...(handle.resumeId ? { resumeId: handle.resumeId } : {}),
        ...(handle.forkPointRenames ? { forkPointRenames: handle.forkPointRenames } : {}),
      }),
    };
    // Recorded before the copy is indexed, so the list that indexing publishes
    // already keeps a side chat out of the sidebar.
    this.d.lineage.record(appSessionId, lineage);
    await this.d.admitCopiedSession(change);
    // The stored row makes the copy a DROIDEX chat and carries the source's
    // settings, which the provider's file does not always hold.
    if (!this.d.registry.updateStoredSummary(appSessionId, copiedSettings(command, source))) {
      throw new Error('The copied chat could not be found after forking.');
    }
    const session = this.d.registry.resolveSummary(appSessionId);
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
          ? modelSettings(command, source)
          : pickedModelSettings(command)),
      },
      { lineage, prompt: formatBranchPrompt(request, sourceConversation(source)) },
    );
  }
}

function copiedSettings(command: SessionForkCommand, source: SessionSummary): SessionSummaryPatch {
  return {
    title: command.title,
    goal: source.goal,
    cwd: source.cwd,
    autonomy: source.autonomy,
    interactionMode: source.interactionMode,
    ...(source.workspaceKind ? { workspaceKind: source.workspaceKind } : {}),
    ...modelSettings(command, source),
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

// Another harness cannot run the source's model; without a pick it starts on its own default.
function pickedModelSettings(command: SessionForkCommand): SessionSummaryPatch {
  return {
    ...(command.modelId ? { modelId: command.modelId } : {}),
    ...(command.reasoningEffort ? { reasoningEffort: command.reasoningEffort } : {}),
  };
}

function sourceConversation(source: SessionSummary): string {
  const providerSessionId = source.providerSessionId ?? source.appSessionId;
  const chain = resolveSessionChain(source.appSessionId, providerSessionId);
  const { events } = loadSessionTranscriptWindow(source.appSessionId, chain, {
    limit: BRANCH_CONTEXT_EVENTS,
  });
  if (events.length === 0) throw new Error('This chat has no stored messages to fork.');
  return conversationMarkdown(events);
}
