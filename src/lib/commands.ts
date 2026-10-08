import { bridge } from './bridge';
import { getRuntimeHealth, subscribeRuntimeHealth } from './runtimeHealth';
import { isAppUpdateInstalling } from './appUpdate';
import type {
  Autonomy,
  BrowserState,
  BrowserViewport,
  BrowserViewportMode,
  ClientCommand,
  ConfigurableSessionRole,
  ContextWindowTokens,
  DesignReference,
  DroidProxyProviderKey,
  HarnessCliProvider,
  InstallChannel,
  McpServerInput,
  PermissionOutcome,
  QuestionAnswer,
  ProviderKind,
  ProviderMention,
  ReasoningEffort,
  ResponseFormat,
  SessionInteractionMode,
  SessionLineage,
  SessionPurpose,
  VoiceNarration,
} from '../types/bridge';
import type { SidebarResult } from '../types/sidebar';

let refCounter = 0;

function requireAgentWorkAvailable(): void {
  if (isAppUpdateInstalling()) {
    throw new Error('DROIDEX is installing an update; new agent work is paused until restart.');
  }
}

export const newClientRef = () => `c-${Date.now().toString(36)}-${String(refCounter++)}`;

export const connect = (apiKey: string) => {
  bridge.send({ type: 'connect', apiKey });
};

export const createSession = (input: {
  clientRef: string;
  cwd?: string;
  title: string;
  goal: string;
  mentions?: ProviderMention[];
  sessionPurpose: SessionPurpose;
  provider?: ProviderKind;
  interactionMode?: SessionInteractionMode;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
  compactionModel?: string;
  compactionTokenLimit?: number | null;
  compactionTokenLimitPerModel?: Record<string, number>;
  autonomy: Autonomy;
  workerModel?: string;
  workerReasoning?: ReasoningEffort;
  validatorModel?: string;
  validatorReasoning?: ReasoningEffort;
  responseFormat?: ResponseFormat;
}) => {
  requireAgentWorkAvailable();
  bridge.send({ type: 'session.create', ...input });
};

export const forkSession = (input: {
  clientRef: string;
  appSessionId: string;
  lineage: SessionLineage['kind'];
  title: string;
  forkPointId?: string;
  prompt?: string;
  provider?: ProviderKind;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
}) => {
  requireAgentWorkAvailable();
  bridge.send({ type: 'session.fork', ...input });
};

export const updateSessionSettings = (input: {
  appSessionId: string;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
  requestId?: string;
  autonomy?: Autonomy;
  interactionMode?: SessionInteractionMode;
}) => {
  bridge.send({ type: 'session.updateSettings', ...input });
};

export const detectEnv = () => {
  bridge.send({ type: 'env.detect' });
};
export const installCli = (channel: InstallChannel) => {
  bridge.send({ type: 'cli.install', channel });
};
export const updateCli = (channel?: InstallChannel) => {
  bridge.send({ type: 'cli.update', channel });
};
export const checkHarnessClis = () => {
  bridge.send({ type: 'harness.cli.check' });
};
export const updateHarnessCli = (provider: HarnessCliProvider) => {
  bridge.send({ type: 'harness.cli.update', provider });
};
export const requestDroidProxyStatus = () => {
  bridge.send({ type: 'droidproxy.status' });
};
export const launchDroidProxy = () => {
  bridge.send({ type: 'droidproxy.launch' });
};
export const startDroidProxyLogin = (provider: DroidProxyProviderKey) => {
  bridge.send({ type: 'droidproxy.login', provider });
};
export const cancelDroidProxyLogin = () => {
  bridge.send({ type: 'droidproxy.login.cancel' });
};
export const setDroidProxyAccountEnabled = (
  provider: DroidProxyProviderKey,
  id: string,
  enabled: boolean,
) => {
  bridge.send({ type: 'droidproxy.account.setEnabled', provider, id, enabled });
};
export const installDroidProxy = () => {
  bridge.send({ type: 'droidproxy.install' });
};
export const cancelDroidProxyInstall = () => {
  bridge.send({ type: 'droidproxy.install.cancel' });
};
export const applyDroidProxyFactoryModels = () => {
  bridge.send({ type: 'droidproxy.factoryModels.apply' });
};

/** The project graph: which sessions are threads, and what each project is doing. */
export const listProjects = () => {
  bridge.send({ type: 'projects.list' });
};

export const listModels = () => {
  bridge.send({ type: 'catalog.models' });
};
export const refreshProviders = () => {
  bridge.send({ type: 'provider.refresh' });
};
export const listSkills = (providerSessionId?: string) => {
  bridge.send({ type: 'catalog.skills', providerSessionId });
};
export const listMcpServers = (requestId: string, cwd?: string) => {
  bridge.send({ type: 'mcp.list', requestId, ...(cwd ? { cwd } : {}) });
};
export const addMcpServer = (requestId: string, server: McpServerInput, cwd?: string) => {
  bridge.send({ type: 'mcp.add', requestId, server, ...(cwd ? { cwd } : {}) });
};
export const removeMcpServer = (requestId: string, serverName: string, cwd?: string) => {
  bridge.send({ type: 'mcp.remove', requestId, serverName, ...(cwd ? { cwd } : {}) });
};
export const toggleMcpServer = (
  requestId: string,
  serverName: string,
  enabled: boolean,
  cwd?: string,
) => {
  bridge.send({ type: 'mcp.toggle', requestId, serverName, enabled, ...(cwd ? { cwd } : {}) });
};
export const authenticateMcpServer = (requestId: string, serverName: string, cwd?: string) => {
  bridge.send({ type: 'mcp.authenticate', requestId, serverName, ...(cwd ? { cwd } : {}) });
};
export const listFactoryDefaults = () => {
  bridge.send({ type: 'settings.defaults' });
};

// A steer id hands the prompt to the running turn; without one, a send while
// the turn runs waits for it to end.
export const sendToSession = (
  appSessionId: string,
  text: string,
  responseFormat?: ResponseFormat,
  mentions?: ProviderMention[],
  steerId?: string,
) => {
  requireAgentWorkAvailable();
  bridge.send({
    type: 'session.send',
    appSessionId,
    text,
    ...(mentions?.length ? { mentions } : {}),
    ...(responseFormat ? { responseFormat } : {}),
    ...(steerId ? { steerId } : {}),
  });
};

export const repairApp = (appSessionId: string, error: string, source: string) => {
  requireAgentWorkAvailable();
  bridge.send({ type: 'session.repairApp', appSessionId, error, source });
};

// Stops the running turn so a steer the model has not taken in yet goes first.
export const sendSteerNow = (appSessionId: string, steerId: string) => {
  requireAgentWorkAvailable();
  bridge.send({ type: 'session.sendNow', appSessionId, steerId });
};

// Waits for the sidecar's definitive answer: a late "taken back" must still
// reach the chat, or the steer would vanish without coming back. Only losing
// the connection, which also loses that answer, ends the wait early.
export const withdrawSteer = (
  appSessionId: string,
  steerId: string,
): Promise<{ withdrawn: boolean; lost?: true; text?: string; mentions?: ProviderMention[] }> => {
  const requestId = newClientRef();
  return new Promise((resolve) => {
    let stopWatchingHealth: () => void = () => undefined;
    const stopListening = bridge.subscribe((event) => {
      if (
        event.type !== 'session.steerWithdrawn' ||
        event.requestId !== requestId ||
        event.appSessionId !== appSessionId ||
        event.steerId !== steerId
      )
        return;
      stopWatchingHealth();
      stopListening();
      resolve({
        withdrawn: event.withdrawn,
        ...(event.text !== undefined ? { text: event.text } : {}),
        ...(event.mentions ? { mentions: event.mentions } : {}),
      });
    });
    // A lost answer must be requested again once the bridge reconnects.
    stopWatchingHealth = subscribeRuntimeHealth(() => {
      if (getRuntimeHealth().transport === 'connected') return;
      stopWatchingHealth();
      stopListening();
      resolve({ withdrawn: false, lost: true });
    });
    if (
      !bridge.sendIfConnected({ type: 'session.withdrawSteer', appSessionId, steerId, requestId })
    ) {
      stopWatchingHealth();
      stopListening();
      resolve({ withdrawn: false, lost: true });
    }
  });
};

export const sendToChild = (
  parentAppSessionId: string,
  childSessionId: string,
  text: string,
  responseFormat?: ResponseFormat,
) => {
  requireAgentWorkAvailable();
  bridge.send({
    type: 'child.send',
    parentAppSessionId,
    childSessionId,
    text,
    ...(responseFormat ? { responseFormat } : {}),
  });
};

export const respondPermission = (
  appSessionId: string,
  requestId: string,
  outcome: PermissionOutcome,
) => {
  bridge.send({ type: 'approval.respond', appSessionId, requestId, outcome });
};

export const respondQuestion = (
  appSessionId: string,
  requestId: string,
  cancelled: boolean,
  answers: QuestionAnswer[],
) => {
  bridge.send({ type: 'question.respond', appSessionId, requestId, cancelled, answers });
};

export const interruptSession = (appSessionId: string) => {
  bridge.send({ type: 'session.interrupt', appSessionId });
};

// Stops the session's runtime for good: its turn, processes and provider.
export const closeSession = (appSessionId: string) => {
  bridge.send({ type: 'session.close', appSessionId });
};

export const compactSession = (appSessionId: string, customInstructions?: string) => {
  bridge.send({ type: 'session.compact', appSessionId, customInstructions });
};

// Voice runs on the chat's own thread and model: this relays the WebRTC
// handshake the renderer negotiated, never the audio. The answer arrives as a
// `voice.answer` event for the same chat.
export const startVoice = (input: {
  appSessionId: string;
  sdp: string;
  attempt: string;
  voice?: string;
  narration?: VoiceNarration;
}) => {
  requireAgentWorkAvailable();
  bridge.send({ type: 'voice.start', ...input });
};

export const stopVoice = (input: { appSessionId: string }) => {
  bridge.send({ type: 'voice.stop', ...input });
};

// The spoken voices the chat's provider offers; answered by a `voice.voices`
// event for the same chat.
export const requestVoices = (input: { appSessionId: string }) => {
  bridge.send({ type: 'voice.voices', ...input });
};

export const interruptChild = (parentAppSessionId: string, childSessionId: string) => {
  bridge.send({
    type: 'child.interrupt',
    parentAppSessionId,
    childSessionId,
  });
};

export const interruptVisibleSession = (
  parentAppSessionId: string,
  childSessionId?: string | null,
) => {
  if (childSessionId) {
    interruptChild(parentAppSessionId, childSessionId);
  } else {
    interruptSession(parentAppSessionId);
  }
};

let childOpenRequestCounter = 0;
export const newChildOpenRequestId = () =>
  `child-open-${Date.now().toString(36)}-${(childOpenRequestCounter++).toString(36)}`;

export const openChild = (
  parentAppSessionId: string,
  childSessionId: string,
  requestId: string,
) => {
  bridge.send({ type: 'child.open', parentAppSessionId, childSessionId, requestId });
};

export const stopAgentProcess = (appSessionId: string, pid: number) => {
  bridge.send({ type: 'session.processes.stop', appSessionId, pid });
};

// Best-effort sync of a chat rename to the harness's own session title. The
// app-level displayTitle (lib/chatMetadata) stays the UI source of truth, so
// a failure here only means other clients keep the generated title.
export const renameSession = (appSessionId: string, title: string) => {
  bridge.send({ type: 'session.rename', appSessionId, title });
};

// Full chat transcript rendered as Markdown by the sidecar, which reads the
// stored session file from disk — so the export is complete even for a chat
// that was never opened in this app run.
export const exportSessionMarkdown = (appSessionId: string, title: string): Promise<string> => {
  const requestId = newClientRef();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out while exporting the chat.'));
    }, 10_000);
    const unsubscribe = bridge.subscribe((event) => {
      // A sidecar older than this renderer answers unknown commands with
      // bridge.unsupported_command instead of the awaited reply; fail the
      // export immediately rather than waiting out the timeout. Only the
      // event echoing this request's id is ours — a foreign unsupported
      // command failing concurrently must not reject this export.
      if (
        event.type === 'error' &&
        event.code === 'bridge.unsupported_command' &&
        event.requestId === requestId
      ) {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        // The code rides along so the caller can skip its own toast: the
        // global bridge subscriber already surfaced the skew error.
        reject(Object.assign(new Error(event.message), { code: event.code }));
        return;
      }
      if (event.type !== 'session.markdownExported' || event.requestId !== requestId) return;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      if (event.ok) resolve(event.markdown);
      else reject(new Error(event.message));
    });
    if (
      !bridge.sendIfConnected({ type: 'session.exportMarkdown', appSessionId, requestId, title })
    ) {
      globalThis.clearTimeout(timeout);
      unsubscribe();
      reject(new Error('Reconnect to DROIDEX before exporting a chat.'));
    }
  });
};

export const reanchorSessionsForWorktreeRemoval = (
  fromCwd: string,
  toCwd: string,
): Promise<number> => {
  const requestId = newClientRef();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out while updating sessions that used this worktree.'));
    }, 10_000);
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type !== 'sessions.cwdReanchored' || event.requestId !== requestId) return;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      if (event.ok) resolve(event.count);
      else reject(new Error(event.message ?? 'Could not update sessions that used this worktree.'));
    });
    if (!bridge.sendIfConnected({ type: 'sessions.reanchorCwd', requestId, fromCwd, toCwd })) {
      globalThis.clearTimeout(timeout);
      unsubscribe();
      reject(new Error('Reconnect to DROIDEX before removing a worktree.'));
    }
  });
};

export const listSessions = (options?: {
  workspaceCwds?: string[];
  includePlainChats?: boolean;
  revealEarlierCwds?: string[];
}) => {
  bridge.send({ type: 'sessions.list', ...options });
};

export const loadSessionHistory = (appSessionId: string, cursor?: string, limit?: number) => {
  bridge.send({ type: 'session.loadHistory', appSessionId, cursor, limit });
};

export const loadChildHistory = (
  parentAppSessionId: string,
  childSessionId: string,
  cursor?: string,
  limit?: number,
) => {
  bridge.send({
    type: 'child.loadHistory',
    parentAppSessionId,
    childSessionId,
    cursor,
    limit,
  });
};

// Transcript content search; the matching sessions.searchResults event
// carries the same requestId so callers can drop stale responses.
export const searchSessions = (requestId: string, query: string) => {
  bridge.send({ type: 'sessions.search', requestId, query });
};

export const setHistoryIndexingIdle = (isIdle: boolean) => {
  return bridge.sendIfConnected({ type: 'history.indexingIdle', isIdle });
};

export const setBackgroundWork = (
  tier: 'interactive' | 'hidden' | 'low-power',
  focusedAppSessionId: string | null,
  visibleAppSessionIds: string[],
) => {
  return bridge.sendIfConnected({
    type: 'app.backgroundWork',
    tier,
    focusedAppSessionId,
    visibleAppSessionIds,
  });
};

export const updateAgentSettings = (input: {
  appSessionId?: string;
  agent: ConfigurableSessionRole;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
}) => {
  bridge.send({ type: 'settings.agent.update', ...input });
};

export const updateChildSettings = (input: {
  parentAppSessionId: string;
  childSessionId: string;
  modelId: string | null;
  reasoningEffort?: ReasoningEffort;
}) => {
  bridge.send({ type: 'child.updateSettings', ...input });
};

export const updateCompactionSettings = (input: {
  compactionTokenLimit?: number | null;
  compactionTokenLimitPerModel?: Record<string, number>;
}) => {
  bridge.send({ type: 'settings.compaction.update', ...input });
};

export const openBrowser = (input: {
  appSessionId: string;
  url: string;
  viewport?: BrowserViewport;
  viewportMode?: BrowserViewportMode;
}) => {
  bridge.send({ type: 'browser.open', ...input });
};

/** The browsers the app kept, keyed by chat, for the sidecar to take up so their panes keep working. */
export const restoreBrowsersCommand = (
  browsers: Record<string, BrowserState>,
): ClientCommand | null => {
  const kept = Object.entries(browsers).map(([appSessionId, browser]) => ({
    appSessionId,
    browserSessionId: browser.browserSessionId,
    url: browser.url,
    viewport: browser.viewport,
    viewportMode: browser.viewportMode,
  }));
  return kept.length > 0 ? { type: 'browser.restore', browsers: kept } : null;
};

export const reloadBrowser = (appSessionId: string) => {
  bridge.send({ type: 'browser.reload', appSessionId });
};

export const resizeBrowserViewport = (input: {
  appSessionId: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  /** The pane's size for Fit, taken only while the page is on Fit. */
  follow?: boolean;
}) => {
  bridge.send({ type: 'browser.resizeViewport', ...input });
};

export const addDesignReference = (appSessionId: string, reference: DesignReference) => {
  bridge.send({ type: 'browser.design.addReference', appSessionId, reference });
};

export const removeDesignReferences = (appSessionId: string, ids: string[]) => {
  bridge.send({ type: 'browser.design.removeReferences', appSessionId, ids });
};

/** Sends a prompt with its marks, as sendToSession sends any other. */
export const sendDesignPrompt = (
  appSessionId: string,
  instruction: string,
  references: DesignReference[],
  responseFormat?: ResponseFormat,
  mentions?: ProviderMention[],
) => {
  requireAgentWorkAvailable();
  bridge.send({
    type: 'browser.design.sendPrompt',
    appSessionId,
    instruction,
    references,
    ...(mentions?.length ? { mentions } : {}),
    ...(responseFormat ? { responseFormat } : {}),
  });
};

export const sendSidebarResult = (result: SidebarResult) => {
  bridge.send({ type: 'sidebar.result', result });
};
