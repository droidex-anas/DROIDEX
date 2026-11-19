import type { CanvasCommand } from './canvas.js';
import type { ProjectCommand } from './projects.js';
import type { AutomationBridgeCommand } from './automations.js';
import type { McpClientCommand } from './mcp.js';
import type { DroidProxyProviderKey, HarnessCliProvider, InstallChannel } from './environment.js';
import type { DroidProfile, ProviderKind } from './providers.js';
import type { ProviderMention } from './catalog.js';
import type { CanvasTurnContext } from './canvas-state.js';
import type {
  Autonomy,
  ContextWindowTokens,
  ReasoningEffort,
  ResponseFormat,
  SessionInteractionMode,
  SessionLineage,
  SessionPurpose,
} from './sessions.js';
import type { VoiceNarration } from './events.js';
import type {
  BrowserViewport,
  BrowserViewportMode,
  DesignReference,
  PermissionOutcome,
} from './browser.js';
import type { ConfigurableSessionRole, QuestionAnswer } from './transcript.js';
import type { SidebarResult } from './sidebar.js';

// ── Frontend -> Sidecar ──────────────────────────────────────────────
export type ClientCommand =
  | CanvasCommand
  | ProjectCommand
  | AutomationBridgeCommand
  | McpClientCommand
  | { type: 'connect'; apiKey?: string }
  | { type: 'runtime.status' }
  | { type: 'auth.status' }
  | { type: 'env.detect' }
  | { type: 'cli.install'; channel: InstallChannel }
  | { type: 'cli.update'; channel?: InstallChannel }
  | { type: 'harness.cli.check' }
  | { type: 'harness.cli.install'; provider: HarnessCliProvider; channel: InstallChannel }
  | { type: 'harness.cli.update'; provider: HarnessCliProvider }
  | { type: 'droidproxy.status' }
  | { type: 'droidproxy.launch' }
  | { type: 'droidproxy.login'; provider: DroidProxyProviderKey }
  | { type: 'droidproxy.login.cancel' }
  | {
      type: 'droidproxy.account.setEnabled';
      provider: DroidProxyProviderKey;
      id: string;
      enabled: boolean;
    }
  | { type: 'droidproxy.install' }
  | { type: 'droidproxy.install.cancel' }
  | { type: 'droidproxy.factoryModels.apply' }
  | { type: 'catalog.models' }
  | { type: 'provider.refresh' }
  // Asks for a harness's account usage, answered by `usage.updated`. With
  // `panelOpen`, /usage shows it: the read may start a short-lived harness
  // process when no session of the harness is live. `immediate` skips the
  // pause kept between automatic reads.
  | { type: 'usage.refresh'; provider: ProviderKind; panelOpen: boolean; immediate: boolean }
  | { type: 'catalog.tools'; providerSessionId?: string }
  | { type: 'catalog.skills'; providerSessionId?: string }
  | { type: 'settings.defaults' }
  | {
      type: 'session.create';
      droidProfile?: DroidProfile;
      clientRef: string;
      // Establishes Design purpose; commit attachment before publication and the first turn.
      canvas?: { canvasId: string | null; name?: string; mutationId: string };
      cwd?: string;
      title: string;
      goal: string;
      // Catalog rows staged with the first prompt, as on a send.
      mentions?: ProviderMention[];
      // What the first prompt pinned, as `session.send` carries it.
      canvasContext?: CanvasTurnContext;
      sessionPurpose: SessionPurpose;
      // Omitted means the default provider.
      provider?: ProviderKind;
      interactionMode?: SessionInteractionMode;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
      fastMode?: boolean;
      contextWindowTokens?: ContextWindowTokens;
      compactionModel?: string;
      compactionTokenLimit?: number | null;
      compactionTokenLimitPerModel?: Record<string, number>;
      // Explicit snapshot chosen by the sender; there is no sidecar fallback.
      autonomy: Autonomy;
      workerModel?: string;
      workerReasoning?: ReasoningEffort;
      validatorModel?: string;
      validatorReasoning?: ReasoningEffort;
      responseFormat?: ResponseFormat;
    }
  | {
      type: 'session.send';
      appSessionId: string;
      text: string;
      mentions?: ProviderMention[];
      responseFormat?: ResponseFormat;
      // Hands the prompt to the running turn as a steer under this id, which
      // the renderer chose for its own row. Absent, a send while a turn runs
      // waits for the turn to end.
      steerId?: string;
      // What the Canvas pane had selected when this prompt was composed. It
      // travels beside the text and is never concatenated into it (spec §9);
      // the turn that runs this prompt mints its lease from it.
      canvasContext?: CanvasTurnContext;
    }
  // Stops the running turn so a steer the model has not taken in yet goes first.
  | { type: 'session.sendNow'; appSessionId: string; steerId: string }
  // Replies with session.steerWithdrawn; true confirms the model cannot see it.
  | { type: 'session.withdrawSteer'; appSessionId: string; steerId: string; requestId: string }
  | { type: 'session.repairApp'; appSessionId: string; error: string; source: string }
  | { type: 'session.resume'; appSessionId: string }
  | { type: 'session.interrupt'; appSessionId: string }
  | {
      type: 'voice.start';
      appSessionId: string;
      sdp: string;
      /** Names this negotiation, so its answer is not taken by the next one. */
      attempt: string;
      voice?: string;
      narration?: VoiceNarration;
    }
  | { type: 'voice.stop'; appSessionId: string }
  | { type: 'voice.voices'; appSessionId: string }
  | {
      type: 'session.updateSettings';
      appSessionId: string;
      modelId?: string | null;
      // null clears the effort: the model chosen offers none.
      reasoningEffort?: ReasoningEffort | null;
      // Omitted leaves the chat's fast mode as it is.
      fastMode?: boolean;
      // Omitted leaves the chat's context window as it is.
      contextWindowTokens?: ContextWindowTokens;
      // Echoed by each model or autonomy settlement event, including failures.
      requestId?: string;
      autonomy?: Autonomy;
      interactionMode?: SessionInteractionMode;
    }
  | { type: 'session.compact'; appSessionId: string; customInstructions?: string }
  | {
      // Copies a session into a new one, answered with this clientRef. On the
      // source's provider the conversation is copied and the answer is
      // `session.forked`, then `prompt` (if any) is sent to the copy. Another
      // provider cannot copy it, nor can a side chat copy a turn in progress,
      // so then a new session opens on the source transcript plus `prompt`,
      // answered by `session.created` like any create. A fork of a streaming
      // session fails. `forkPointId` (an answer's) cuts a native copy after
      // that answer; without it the whole conversation is copied.
      type: 'session.fork';
      clientRef: string;
      appSessionId: string;
      lineage: SessionLineage['kind'];
      title: string;
      forkPointId?: string;
      prompt?: string;
      provider?: ProviderKind;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
    }
  | { type: 'session.rename'; appSessionId: string; title: string }
  | {
      // Full-transcript Markdown export ("Copy as Markdown"). `title` is the
      // renderer's effective (possibly user-renamed) title for the header.
      type: 'session.exportMarkdown';
      appSessionId: string;
      requestId: string;
      title?: string;
    }
  | { type: 'sessions.reanchorCwd'; requestId: string; fromCwd: string; toCwd: string }
  | { type: 'session.rewindInfo'; appSessionId: string }
  | { type: 'session.rewind'; appSessionId: string; rewindId?: string }
  | { type: 'session.close'; appSessionId: string }
  | { type: 'session.processes.stop'; appSessionId: string; pid: number }
  | {
      type: 'sessions.list';
      workspaceCwds?: string[];
      includePlainChats?: boolean;
      // Workspaces whose pre-existing session bound the user lifted.
      revealEarlierCwds?: string[];
    }
  | { type: 'session.loadHistory'; appSessionId: string; cursor?: string; limit?: number }
  | { type: 'sessions.search'; requestId: string; query: string }
  | { type: 'history.indexingIdle'; isIdle: boolean }
  | {
      type: 'app.backgroundWork';
      tier: 'interactive' | 'hidden' | 'low-power';
      // The chat the user is working in, and every chat on screen including it.
      focusedAppSessionId: string | null;
      visibleAppSessionIds: string[];
    }
  | {
      type: 'child.open';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
    }
  | {
      type: 'child.send';
      parentAppSessionId: string;
      childSessionId: string;
      text: string;
      responseFormat?: ResponseFormat;
    }
  | { type: 'child.interrupt'; parentAppSessionId: string; childSessionId: string }
  | {
      type: 'child.loadHistory';
      parentAppSessionId: string;
      childSessionId: string;
      cursor?: string;
      limit?: number;
    }
  | {
      type: 'child.updateSettings';
      parentAppSessionId: string;
      childSessionId: string;
      modelId: string | null;
      reasoningEffort?: ReasoningEffort;
    }
  | {
      type: 'child.watchHistory';
      requestId: string;
      target: {
        parentAppSessionId: string;
        childSessionId: string;
        limit?: number;
      } | null;
    }
  | {
      type: 'approval.respond';
      appSessionId: string;
      requestId: string;
      outcome: PermissionOutcome;
    }
  | {
      type: 'question.respond';
      appSessionId: string;
      requestId: string;
      cancelled: boolean;
      answers: QuestionAnswer[];
    }
  | { type: 'history.list' }
  | { type: 'history.page'; providerSessionId: string; cursor?: string; limit?: number }
  | {
      type: 'settings.agent.update';
      appSessionId?: string;
      agent: ConfigurableSessionRole;
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort | null;
    }
  | {
      // Snapshot of the app's explicitly configured compaction limits. A null
      // global or empty per-model map means the user cleared that tier; omitted
      // fields continue following CLI-file defaults.
      type: 'settings.compaction.update';
      compactionTokenLimit?: number | null;
      compactionTokenLimitPerModel?: Record<string, number>;
    }
  | {
      type: 'browser.open';
      appSessionId: string;
      url: string;
      viewport?: BrowserViewport;
      viewportMode?: BrowserViewportMode;
    }
  | { type: 'browser.close'; appSessionId: string }
  | { type: 'browser.reload'; appSessionId: string }
  | {
      // The browsers the app kept from its last run, sent on each connection.
      // The sidecar takes up any it lacks under the same id, leaving the page.
      type: 'browser.restore';
      browsers: {
        appSessionId: string;
        browserSessionId: string;
        url: string;
        viewport: BrowserViewport;
        viewportMode: BrowserViewportMode;
      }[];
    }
  | {
      type: 'browser.resizeViewport';
      appSessionId: string;
      viewport: BrowserViewport;
      viewportMode: BrowserViewportMode;
      /** The pane's size for Fit, taken only while the page is on Fit. */
      follow?: boolean;
    }
  | { type: 'browser.design.addReference'; appSessionId: string; reference: DesignReference }
  /** Marks the user took away or picked again, so design-mode reads only live ones. */
  | { type: 'browser.design.removeReferences'; appSessionId: string; ids: string[] }
  | {
      type: 'browser.design.sendPrompt';
      appSessionId: string;
      instruction: string;
      /** The prompt's own snapshots of its marks, each under an id no other pick has. */
      references: DesignReference[];
      mentions?: ProviderMention[];
      responseFormat?: ResponseFormat;
      // What the prompt pinned, as `session.send` carries it.
      canvasContext?: CanvasTurnContext;
    }
  | { type: 'sidebar.result'; result: SidebarResult };
