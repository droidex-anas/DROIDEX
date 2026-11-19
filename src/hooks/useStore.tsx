import type { ReactNode } from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { bridge } from '../lib/bridge';
import { isRemoteClient } from '../lib/desktop';
import { updateCompactionSettings } from '../lib/commands';
import { reducePrInbox, type PrInboxAction } from '../features/pull-requests/lib/prInboxState';
import {
  activeDraftTileId,
  composeOrigin,
  draftTileIds,
  enteredPlaceNavigation,
  placeCreatedChat,
  showChat,
  showNewChat,
  showView,
  withComposeTileClosed,
  type ComposeOrigin,
} from '../features/tabs/tabNavigation';
import { activeTabDraft, loadTabStrip } from '../features/tabs/tabStorage';
import {
  activeProduct,
  chatsBesideFocus,
  fillsTab,
  isChatInView,
  livePage,
  newDraft,
  reduceTabStrip,
  withoutChats,
  withoutOtherTabsShowing,
  type ProductMode,
  type TabAction,
  type TabStrip,
} from '../features/tabs/tabStrip';
import { focusedTile } from '../features/tabs/tileGrid';
import {
  reduceVoice,
  withoutVoiceSession,
  type VoiceAction,
  type VoiceSessions,
} from '../features/voice/voiceSessions';
import { removeCustomTheme, upsertCustomTheme, type ThemePreset } from '../lib/theme';
import { loadCustomThemes, loadTheme, type ThemeConfig } from './persistedThemePreferences';
import {
  loadAgentConfig,
  loadCompactionModel,
  loadDefaultVoice,
  loadKnownVoices,
  loadDiffView,
  loadHarnessModels,
  loadImagePasteQuality,
  loadLiveEnterBehavior,
  loadNarrationMode,
  loadPersistedUiState,
  loadReviewScope,
  loadSessionLastSeen,
  loadShortcutBindings,
  loadSideChatPlacement,
  loadWorkspaceCwds,
  type AgentConfig,
  type DiffViewMode,
  type HarnessModels,
  type LiveEnterBehavior,
  type MainView,
  type SideChatDefaultPlacement,
} from './persistedUiPreferences';
import type { ShortcutAction, ShortcutBindings } from '../lib/shortcuts';
import type { ProjectView } from '../features/projects/types';
import type { DesignModes } from './designModeState';
import type {
  AgentProcess,
  Autonomy,
  ContextWindowTokens,
  ServerEvent,
  SessionLineage,
  SessionSummary,
  TranscriptEvent,
  ProgressEntry,
  PermissionRequest,
  SessionQuestion,
  ModelInfo,
  ProviderKind,
  ProviderStatus,
  ProviderUsage,
  ChildSessionSummary,
  SkillInfo,
  ContextStatsSnapshot,
  BrowserState,
  VoiceNarration,
} from '../types/bridge';
import { addWorkspaceCwd, removeWorkspaceCwd, withRevealedCwds } from '../lib/workspaces';
import type { QueuedPrompt } from '../lib/promptQueue';
import { createOrderedActionBatcher, type OrderedActionBatcher } from './orderedActionBatcher';
import { isHistoryStatusError, applyHistoryServerEvent } from '../lib/historyHealth';
import { loadDefaultPermissionMode } from '../lib/permissionSemantics';
import type { PendingModelUpdate } from '../lib/pendingModelSettings';
import { loadDraftProvider } from '../features/providers/providerDraft';
import { loadToolActivity, type ToolActivitySettings } from '../lib/toolActivity';
import {
  compactionSettingsSnapshot,
  loadCompactionTokenLimit,
  loadCompactionTokenLimitPerModel,
} from '../lib/compactionSettings';
import { sanitizeForLog } from '../lib/sensitiveLogRedaction';
import { sessionIsLive } from '../lib/sessions';
import { noteStoreCommitted, discardPendingBridgeEvent } from '../lib/rendererPerf';
import {
  addSessionNote,
  loadSessionNotes,
  markSessionNoteUsed,
  removeSessionNote,
  type SessionNotesMap,
} from '../lib/sessionNotes';
import {
  archiveChat,
  deleteChat,
  isChatHidden,
  loadChatMetadata,
  linkChatsPullRequest,
  markDesignChat,
  type ChatPullRequest,
  pinChat,
  renameChat,
  restoreChat,
  unpinChat,
  type ChatMetadataMap,
} from '../lib/chatMetadata';
import { createSnapshotScheduler, loadSessionSnapshot } from '../lib/sessionSnapshot';
import { createComposerSeed, type ComposerSeed } from '../lib/composerReset';
import { toast } from '../lib/toast';
import { type DiffScope } from '../types/vcs';
import {
  removeSessionPanel,
  removeUtilityTool,
  utilityPanelForSession,
  type UtilityPanelState,
} from '../lib/utilityPanel';
import {
  currentSideChat,
  settleSideChatStart,
  sideChatPanel,
  updateSideChatPanel,
  type SideChatHarness,
  type SideChatPanel,
  type SideChatPlacement,
  type SideChatView,
} from '../lib/sideChats';
import type { FileChange } from '../lib/diff';
import type { ImagePasteQuality } from '../lib/images';
import {
  estimateTranscriptCost,
  INACTIVE_TRANSCRIPT_POLICY,
  VIEWPORT_TRANSCRIPT_POLICY,
} from '../lib/transcriptWindow';
import {
  appendTranscriptEvent,
  applyMemoryPressureRelease,
  pruneRemovedSessionState,
  releaseSessionTranscriptWindow,
  withUpdatedTranscript,
} from '../lib/transcriptStoreMemory';
import { type TranscriptMutation } from '../lib/transcriptMutation';
import { reduceSessionChildren } from './storeSessionChildren';
import { reduceStoreActionBatch } from './storeActionBatch';
import { lookup } from './storeLookup';
import { reduceAgentSettings, type AgentSettingsAction } from './storeAgentSettings';
import {
  reduceSessionInteractions,
  type SessionInteractionsAction,
} from './storeSessionInteractions';
import { reduceUtilityPanels, type UtilityPanelsAction } from './storeUtilityPanels';
import { persistStoreChanges } from './storePersistence';
import {
  invalidateSelectedChildOpening,
  reduceChildError,
  reduceChildHistoryLoading,
  reduceChildHistoryLoadingOlder,
  reduceChildTranscriptReleaseViewport,
  reduceChildTranscriptViewport,
  reduceChildUpdated,
  reduceSelectChild,
  releaseInactiveChildTranscript,
  releaseInactiveSelectedChild,
  type ChildAccess,
  type ChildHistoryState,
  type ChildRuntimeState,
  type ChildSelection,
  type ChildSessionInfo,
  type SessionRestore,
} from './storeChildSession';
import {
  reduceSessionHistory,
  reduceSessionHistoryFailed,
  reduceSessionHistoryLoadingOlder,
  reduceSessionRestoreStart,
} from './storeSessionRestore';

export type { ImagePasteQuality } from '../lib/images';

/** What a design draft's next prompt owes Canvas (spec §4). */
export interface CanvasDraft {
  /** Null asks for a new canvas; otherwise the chat joins that one. */
  canvasId: string | null;
}

/** The pane to open once this submitted Design create names its chat. */
export interface CanvasChatRequest {
  /** Null until `session.created` names the chat this request made. */
  appSessionId: string | null;
}

export interface AppState {
  // Connection
  connection: 'idle' | 'connecting' | 'connected' | 'error';
  connectionError?: string;

  // Sessions domain
  sessions: Record<string, SessionSummary>;
  sessionOrder: string[];
  // Every local project as the runtime last reported it. The chat list, the
  // navigation and Projects itself all read this one copy.
  projects: ProjectView[];
  /** True once the runtime has answered with a snapshot, empty or not. */
  projectsLoaded: boolean;
  /** What projects last failed at; the next snapshot retires it. Empty when fine. */
  projectsError: string;
  // Ids vouched for by the last authoritative listing: the boot snapshot
  // before the first SESSION_LIST, then the sessions of the most recent
  // SESSION_LIST. A SESSION_LIST prunes confirmed rows it no longer reports,
  // so a session deleted outside the app disappears on the next list push.
  // Rows added locally this run (SESSION_CREATED/SESSION_UPDATED) are not in
  // the set and survive lists that do not mention them yet.
  listConfirmedSessionIds: string[] | null;
  // Pre-existing sessions the sidecar withheld per workspace cwd, so the
  // sidebar can offer to load a folder's older Droid sessions on demand.
  earlierSessionsByCwd: Record<string, number>;
  // Execution cwds whose withheld sessions the user asked to see. Persisted, so
  // the first list after a restart covers the chats the last one confirmed.
  revealEarlierCwds: string[];
  activeAppSessionId: string | null;
  // appSessionId -> last time the user viewed it. A session reads as "unread" when
  // its updatedAt (latest model activity) is newer than this. Internal only:
  // surfaced as a bold row in the sidebar, never shown as a timestamp.
  sessionLastSeen: Record<string, number>;
  // App-level pin/archive/delete organization per chat. Pure renderer metadata,
  // persisted in localStorage; the harness session data is never touched.
  chatMetadata: ChatMetadataMap;
  transcripts: Record<string, TranscriptEvent[]>;
  // Exact provenance for the latest transcript change. Derived renderers use
  // the revision chain to update a safe suffix or rebuild on any uncertainty.
  transcriptMutations: Record<string, TranscriptMutation>;
  // Relative retained-payload estimate for each in-memory transcript window.
  // This is budgeting telemetry, not a claim about exact V8 heap bytes.
  transcriptRetainedCost: Record<string, number>;
  // Primary transcript viewport state. Normal eviction is allowed only after
  // the viewport is bottom-pinned; scrolled-up reading stays resident.
  transcriptViewportPinned: Partial<Record<string, boolean>>;
  progress: Record<string, ProgressEntry[]>;
  childSessions: Record<string, Record<string, ChildSessionInfo>>;
  agentsWorkingByParent: Partial<Record<string, true>>;
  historyLoaded: Record<string, boolean>;
  // Cursor for the next older page of primary-session scrollback;
  // undefined/absent once the oldest compaction segment has been loaded.
  historyCursor: Record<string, string | undefined>;
  // Whether an older-history page is currently in flight (prevents duplicate
  // prefetches while the user keeps scrolling up).
  historyLoadingOlder: Record<string, boolean>;
  // Explicit transcript-restore state per session: whether the initial replay
  // is loading, partially loaded (older pages remain), fully loaded, or failed.
  // Lets the chat show an honest restoring/partial/retry surface instead of a
  // blank or silently truncated transcript (#29).
  sessionRestore: Partial<Record<string, SessionRestore>>;
  // Child transcripts share the parent event array for live rendering, but
  // each logical child owns an independent persisted-history cursor and
  // viewport lifecycle.
  childHistory: Record<string, Record<string, ChildHistoryState>>;
  childAccess: Record<string, Record<string, ChildAccess>>;
  childRuntime: Record<string, Record<string, ChildRuntimeState>>;
  // Pending permission requests are scoped to the session that asked, so a
  // request from one chat never appears (or gets answered) in another.
  pendingPermissions: Partial<Record<string, PermissionRequest[]>>;
  // Same scoping for AskUser questions: keyed by the asking session.
  pendingQuestions: Partial<Record<string, SessionQuestion[]>>;
  contextStats: {
    primary: Record<string, ContextStatsSnapshot>;
    child: Record<string, Record<string, ContextStatsSnapshot>>;
  };
  specPlans: Record<string, string>; // latest ExitSpecMode plan per session
  // Persisted spec per session (file path + rendered content). Survives exiting
  // spec mode so the inline card, mermaid, and the wiki reader stay available.
  sessionSpecs: Record<string, { path?: string; title: string; content: string }>;
  // Which session's spec is open in the full wiki reader (null = closed).
  specWikiAppSessionId: string | null;
  // Held locally until the current turn finishes, then delivered one at a time.
  promptQueue: Record<string, QueuedPrompt[]>;
  // Scratch notes parked from the Context panel, per session. Persisted in
  // localStorage so reminders survive app restarts.
  sessionNotes: SessionNotesMap;
  // Dev-server / background processes reported by the daemon per session.
  // Runtime-only: not persisted.
  agentProcesses: Record<string, AgentProcess[]>;

  // UI flags
  rightPanelOpen: boolean;
  utilityPanels: Record<string, UtilityPanelState>;
  // The canvas each chat is attached to, as the sidecar last reported it. A
  // missing entry means nobody has asked yet. The manifest owns the attachment,
  // so this is only what keeps a reopened Canvas pane from blinking through its
  // empty state; everything else about a canvas is feature-local.
  canvasAttachments: Record<string, string | null>;
  // The pane requests a Design send has handed to a create request, keyed
  // by that request's `clientRef`. `appSessionId` is null until `session.created`
  // names the chat. Navigation and later drafts never touch one: only its own
  // settlement, a create that failed, or deleting its chat discharges it.
  canvasChatRequests: Record<string, CanvasChatRequest>;
  // The chat Chat returns to after a visit to Design, captured on the way in so
  // the design draft cannot lose it (spec §4). Runtime-only: a restarted window
  // in Design has no chat to go back to.
  chatModeAppSessionId: string | null;
  // The Review diff tab: a wide right-side pane, opened from the Context panel's
  // changes button. Scope + view mode persist; open state is per-session — we
  // track the session it was opened for so switching chats doesn't carry it over.
  reviewOpenAppSessionId: string | null;
  reviewScope: DiffScope;
  // A file path the Review pane should jump to once its list loads, set when a
  // per-turn changes summary (or diff card) is clicked. Cleared after the jump.
  reviewFocusPath: string | null;
  // The change captured in the transcript when the focus request came from a
  // diff card. Review falls back to rendering it when no git scope lists the
  // file (folderless session, or the edit was reverted since the turn).
  reviewFocusChange: FileChange | null;
  // Generation counter for focus requests: every OPEN_REVIEW_AT bumps it so
  // the Review pane can tell a fresh click apart from a re-render of the
  // previous request (a repeated click must re-arm the scope-fallback dedupe).
  reviewFocusRequestId: number;
  diffView: DiffViewMode;
  sidebarCollapsed: boolean;
  mainView: MainView;
  // Header tabs. The active tab's page, or its focused tile, is the live one
  // above (mainView, activeAppSessionId, draftChat); see features/tabs/tabStrip.
  tabStrip: TabStrip;
  automationEditorRequest: AutomationEditorRequest | null;
  prWorkspaceCwd: string | null;
  prWorkspaceNumber: number | null;
  prBacklogIds: string[];
  specMode: boolean;
  settingsOpen: boolean;
  /** Where Settings opens when something outside it asks for a specific place. */
  settingsRequest: SettingsRequest | null;
  commandPaletteOpen: boolean;
  theme: ThemeConfig;
  // User-saved theme presets (built-ins live in lib/theme). Persisted to
  // localStorage; the active one is referenced by theme.presetId.
  customThemes: ThemePreset[];
  missionControlMode: boolean;
  draftChat: {
    cwd: string;
    executionMode: 'worktree' | 'local';
    branch?: string;
    /** The draft starts a project: its first message goes to the project's lead. */
    project?: true;
    /**
     * A design draft: its chat attaches to this canvas, or to a new one when
     * `canvasId` is null. It travels with the draft's tab (spec §4).
     */
    canvas?: CanvasDraft;
  } | null;
  // Persisted app-wide default autonomy for new sessions. Owned by Settings;
  // factory-default reloads and draft/session changes never overwrite it.
  defaultAutonomy: Autonomy;
  // How much detail chat tool activity renders: one aggregate line per run
  // (compact), one line per tool (balanced), or lines with bodies inline
  // (detailed); plus whether folded diff runs default to expanded.
  toolActivity: ToolActivitySettings;
  // Autonomy override for the current unsent draft. Null means the draft
  // follows `defaultAutonomy`; reset whenever the draft lifecycle resets.
  draftAutonomy: Autonomy | null;
  // Fast mode the current unsent draft will be created with. A new chat never
  // inherits it, so it resets with the rest of the draft lifecycle.
  draftFastMode: boolean;
  // Context window the current unsent draft will be created with. Null means
  // the provider's own, and it resets with the rest of the draft lifecycle.
  draftContextWindowTokens: ContextWindowTokens | null;
  // Only the latest request can settle the autonomy shown ahead of confirmation.
  pendingAutonomy: Partial<Record<string, { requestId: string; autonomy: Autonomy }>>;
  // Chat model/effort changes shown ahead of confirmation, keyed by appSessionId.
  pendingModelUpdates: Partial<Record<string, PendingModelUpdate>>;
  // One-shot text seeded into a composer (welcome-screen suggestion cards,
  // saved-note clicks, the browser's prompt box), in arrival order. Each seed
  // belongs to one chat, or one new-chat draft, and waits until its composer
  // takes it.
  composerSeeds: ComposerSeed[];
  workspaceCwds: string[];
  // Per-session browser-pane open state, keyed by browser key (the chat/session
  // id). Presence means "open"; absence means "closed". Persisted so a session
  // resumes where it left off after an app restart, unless it was fully closed.
  browsers: Record<string, BrowserState>;
  browserErrors: Record<string, string>;
  browserGlobalError?: string;
  designModes: DesignModes;
  // Live voice conversations, keyed by appSessionId. Never persisted: a voice
  // session ends with the window that held it.
  voiceSessions: VoiceSessions;

  // Mission Control view
  selectedFeatureId: string | null;
  selectedChild: ChildSelection | null;

  // Models, the model each harness starts a new chat on, and Mission Control's
  // worker/validator picks (its primary uses its harness's entry).
  models: ModelInfo[];
  harnessModels: HarnessModels;
  agentConfig: AgentConfig;

  // What each provider can do for the user right now, as last reported by the
  // sidecar, and the provider the next new session is created on. The draft
  // pick is sticky: it survives session switches and restarts.
  providerStatuses: ProviderStatus[];
  draftProvider: ProviderKind;
  // Each harness account's usage, as the sidecar last reported it.
  usage: Partial<Record<ProviderKind, ProviderUsage>>;

  // Global compaction model applied to every session. 'current-model' = use
  // each session's active model; otherwise a specific model id.
  compactionModel: string;

  // Global default compaction token limit applied to every session. Undefined
  // means "use Factory's model-dependent default".
  compactionTokenLimit?: number;
  // Per-model overrides for the compaction token limit, keyed by model id.
  compactionTokenLimitPerModel: Record<string, number>;
  // Bumped on every compaction-settings change (including clears that leave
  // the values structurally identical, e.g. undefined -> cleared undefined) so
  // the push effect always re-fires and the sidecar snapshot never goes stale.
  compactionSettingsRev: number;
  liveEnterBehavior: LiveEnterBehavior;
  // Fidelity tier for images pasted or dropped into the composer.
  imagePasteQuality: ImagePasteQuality;
  // Voice mode: which voice speaks, and how much of the work it narrates while
  // the agent runs. An empty voice leaves the choice to the harness.
  defaultVoice: string;
  /** The voices the harness last reported, for the picker in Settings. */
  knownVoices: string[];
  narrationMode: VoiceNarration;
  // Chord bound to each rebindable app action (see lib/shortcuts).
  shortcutBindings: ShortcutBindings;

  // Skills catalog (for / invocation)
  skills: SkillInfo[];
  skillsProviderSessionId?: string | null;

  // Attachments for the first message of a not-yet-created session, keyed by clientRef.
  // `origin` is the place the compose was sent from; its chat opens there. It
  // is null once that tile has closed.
  pendingCompose: Partial<
    Record<
      string,
      { text: string; skills: string[]; files: string[]; origin: ComposeOrigin | null }
    >
  >;
  // Where each send was made from while it prepares, before it has a pending
  // compose, keyed by hold id. Null once that tile has closed.
  heldComposeOrigins: Partial<Record<string, ComposeOrigin | null>>;
  // Bounded settlement identity for the latest successful foreground create.
  // PromptInput uses it to distinguish that activation from a failure followed
  // by the user selecting an unrelated existing session.
  lastCreatedSessionRequest: { clientRef: string; appSessionId: string } | null;
  // Forks this renderer asked for and has not heard back about, keyed by clientRef.
  pendingForks: Partial<Record<string, PendingFork>>;
  // Each session's side-chat surface, keyed by the session they branch from.
  sideChats: Partial<Record<string, SideChatPanel>>;
  sideChatDefaultPlacement: SideChatDefaultPlacement;
}

// `prompt` is the copy's first message, which the sidecar sends once it exists.
interface PendingFork {
  kind: SessionLineage['kind'];
  sourceAppSessionId: string;
  prompt?: string;
}

export type Action =
  | { type: 'BATCH'; actions: Action[] }
  // Connection
  | {
      type: 'SET_CONNECTION';
      status: 'idle' | 'connecting' | 'connected' | 'error';
      message?: string;
    }

  // Session lifecycle
  | { type: 'SESSION_CREATED'; clientRef: string; session: SessionSummary }
  | { type: 'FORK_REQUESTED'; clientRef: string; fork: PendingFork }
  | { type: 'SESSION_FORKED'; clientRef: string; session: SessionSummary }
  // Shows a view of a session's side chats and brings their surface forward.
  | { type: 'SHOW_SIDE_CHAT'; sourceAppSessionId: string; view: SideChatView }
  | { type: 'PLACE_SIDE_CHATS'; sourceAppSessionId: string; placement: SideChatPlacement }
  // Takes the side chat off screen; a side chat it names is deleted for good.
  | { type: 'CLOSE_SIDE_CHAT'; sourceAppSessionId: string; appSessionId?: string }
  | { type: 'CHOOSE_SIDE_CHAT_HARNESS'; sourceAppSessionId: string; harness: SideChatHarness }
  | { type: 'ATTACH_SIDE_CHAT_REPLY'; sourceAppSessionId: string; reply: string }
  | { type: 'DETACH_SIDE_CHAT_REPLIES'; sourceAppSessionId: string; replies: readonly string[] }
  | { type: 'SET_SIDE_CHAT_DEFAULT_PLACEMENT'; placement: SideChatDefaultPlacement }
  | {
      type: 'SET_PENDING_COMPOSE';
      clientRef: string;
      text: string;
      skills: string[];
      files: string[];
      // The hold whose place the compose takes, read here rather than by the
      // caller so a tile closed in the meantime is already forgotten.
      originHoldId: string | null;
      // The draft captured by this send, before asynchronous preparation.
      canvas?: CanvasDraft;
    }
  // A send holds the place it was made from until its pending compose takes it.
  | { type: 'HOLD_COMPOSE_ORIGIN'; holdId: string }
  | { type: 'RELEASE_COMPOSE_ORIGIN'; holdId: string }
  | { type: 'SESSION_UPDATED'; session: SessionSummary }
  | { type: 'SESSION_CLOSED'; appSessionId: string }
  | { type: 'SESSION_PROCESSES'; appSessionId: string; processes: AgentProcess[] }
  | { type: 'SESSIONS_PROCESSES'; processes: Record<string, AgentProcess[]> }
  | { type: 'PROJECTS_SNAPSHOT'; projects: ProjectView[] }
  | { type: 'PROJECTS_UNAVAILABLE'; message: string }
  // App-level chat organization (rename/pin/archive/delete); see lib/chatMetadata.
  // A blank RENAME_CHAT title clears the override back to the generated title.
  | { type: 'LINK_CHATS_PR'; appSessionIds: readonly string[]; cwd: string; pr: ChatPullRequest }
  | { type: 'RENAME_CHAT'; appSessionId: string; title: string }
  | { type: 'SET_CHAT_METADATA'; chatMetadata: ChatMetadataMap }
  | { type: 'PIN_CHAT'; appSessionId: string }
  // A chat shown through Design opens as a design from then on.
  | { type: 'MARK_DESIGN_CHAT'; appSessionId: string }
  | { type: 'UNPIN_CHAT'; appSessionId: string }
  | { type: 'ARCHIVE_CHAT'; appSessionId: string }
  | { type: 'RESTORE_CHAT'; appSessionId: string }
  | { type: 'DELETE_CHAT'; appSessionId: string }
  | { type: 'SESSION_FEATURES'; appSessionId: string; features: SessionSummary['features'] }
  | { type: 'SESSION_PROGRESS'; appSessionId: string; entries: ProgressEntry[] }
  | {
      type: 'SESSION_CHILD';
      child: ChildSessionSummary;
      runtimeAvailable: boolean;
      runtimeGeneration: number;
    }
  | (
      | {
          type: 'CHILD_UPDATED';
          parentAppSessionId: string;
          childSessionId: string;
          requestId: string;
          access: 'ready';
          runtimeGeneration: number;
        }
      | {
          type: 'CHILD_UPDATED';
          parentAppSessionId: string;
          childSessionId: string;
          requestId: string;
          access: 'history';
        }
    )
  | {
      type: 'CHILD_ERROR';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string | null;
      operation: 'open' | 'loadHistory' | 'send' | 'interrupt' | 'settings';
      message: string;
    }
  | {
      type: 'SESSION_TOKENS';
      appSessionId: string;
      tokensIn: number;
      tokensOut: number;
      contextTokens: number;
      maxContextTokens?: number;
    }
  | {
      type: 'CONTEXT_UPDATED';
      appSessionId: string;
      sourceSessionId: string;
      parentAppSessionId?: string;
      childSessionId?: string;
      stats: ContextStatsSnapshot;
    }
  | { type: 'SESSION_TRANSCRIPT'; event: TranscriptEvent }
  | { type: 'TRANSCRIPT_VIEWPORT'; appSessionId: string; pinned: boolean }
  | { type: 'TRANSCRIPT_RELEASE_VIEWPORT'; appSessionId: string }
  | { type: 'MEMORY_PRESSURE' }
  | { type: 'QUEUE_PROMPT'; appSessionId: string; prompt: QueuedPrompt }
  | { type: 'REMOVE_QUEUED_PROMPT'; appSessionId: string; id: string }
  | { type: 'REORDER_QUEUE'; appSessionId: string; from: number; to: number }
  | SessionInteractionsAction
  | {
      type: 'SESSION_ERROR';
      appSessionId?: string;
      providerSessionId?: string;
      message: string;
    }
  | { type: 'SESSION_CREATE_FAILED'; clientRef: string; message: string }
  | {
      type: 'SESSION_LIST';
      sessions: SessionSummary[];
      earlierSessionsByCwd: Record<string, number>;
    }
  | {
      type: 'SESSION_HISTORY';
      appSessionId: string;
      childSessionId?: string;
      progress: ProgressEntry[];
      transcripts: TranscriptEvent[];
      childSessions?: ChildSessionSummary[];
      mode?: 'replace' | 'prepend' | 'refresh';
      olderCursor?: string;
      loadedCount?: number;
      hasMore?: boolean;
    }
  | { type: 'SESSION_RESTORE_START'; appSessionId: string }
  | {
      type: 'SESSION_HISTORY_FAILED';
      appSessionId: string;
      childSessionId?: string;
      message: string;
    }
  | { type: 'SESSION_HISTORY_LOADING_OLDER'; appSessionId: string }
  | {
      type: 'CHILD_HISTORY_LOADING';
      parentAppSessionId: string;
      childSessionId: string;
    }
  | {
      type: 'CHILD_HISTORY_LOADING_OLDER';
      parentAppSessionId: string;
      childSessionId: string;
    }
  | {
      type: 'CHILD_TRANSCRIPT_VIEWPORT';
      parentAppSessionId: string;
      childSessionId: string;
      pinned: boolean;
    }
  | {
      type: 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT';
      parentAppSessionId: string;
      childSessionId: string;
    }

  // UI
  | { type: 'SET_ACTIVE_SESSION'; id: string | null }
  | { type: 'MARK_ALL_SESSIONS_READ'; seenAt: number }
  | UtilityPanelsAction
  | { type: 'SET_CANVAS_ATTACHMENT'; appSessionId: string; canvasId: string | null }
  // The design bootstrap finished with this chat, either way; it must not run again.
  | { type: 'CANVAS_CHAT_SETTLED'; appSessionId: string }
  | { type: 'SET_PRODUCT_MODE'; mode: ProductMode }
  | { type: 'SET_DRAFT_PRODUCT'; mode: ProductMode }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'CLOSE_COMMAND_PALETTE' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'OPEN_SETTINGS'; request: SettingsRequest }
  | { type: 'TOGGLE_MISSION_CONTROL' }
  | { type: 'OPEN_PROJECTS' }
  | { type: 'CLOSE_PROJECTS' }
  | { type: 'OPEN_AUTOMATIONS'; automationId?: string }
  | { type: 'CLOSE_AUTOMATIONS' }
  | { type: 'AUTOMATION_EDITOR_REQUEST_HANDLED'; requestId: number }
  | PrInboxAction
  | TabAction
  // A chat dropped on a tile's center shows in that tile; a null tile is the
  // whole page of a tab that is not split.
  | { type: 'DROP_CHAT'; tileId: string | null; appSessionId: string }
  | VoiceAction
  | {
      type: 'START_CHAT';
      cwd: string;
      executionMode: 'worktree' | 'local';
      branch?: string;
      project?: true;
      // Absent for an ordinary New chat, which starts with no canvas at all.
      canvas?: CanvasDraft;
    }
  | {
      type: 'SEED_COMPOSER';
      text: string;
      replace?: boolean;
      appSessionId?: string;
      send?: boolean;
      focus?: boolean;
      prompt?: QueuedPrompt;
    }
  | { type: 'CONSUME_COMPOSER_SEED'; id: number }
  | { type: 'SESSION_NOTE_ADD'; appSessionId: string; text: string }
  | { type: 'SESSION_NOTE_MARK_USED'; appSessionId: string; noteId: string }
  | { type: 'SESSION_NOTE_REMOVE'; appSessionId: string; noteId: string }
  | { type: 'ADD_WORKSPACE'; cwd: string }
  | { type: 'REMOVE_WORKSPACE'; cwd: string }
  | { type: 'SET_WORKSPACE_CWDS'; cwds: string[] }
  | { type: 'REVEAL_EARLIER_SESSIONS'; executionCwds: readonly string[] }
  | { type: 'SET_THEME'; theme: Partial<ThemeConfig> }
  | { type: 'SAVE_CUSTOM_THEME'; preset: ThemePreset }
  | { type: 'DELETE_CUSTOM_THEME'; id: string }
  | { type: 'SELECT_FEATURE'; id: string | null }
  | { type: 'SELECT_CHILD'; selection: ChildSelection | null; requestId?: string }
  | AgentSettingsAction
  | { type: 'SET_LIVE_ENTER_BEHAVIOR'; behavior: LiveEnterBehavior }
  | { type: 'SET_IMAGE_PASTE_QUALITY'; quality: ImagePasteQuality }
  | { type: 'SET_DEFAULT_VOICE'; voice: string }
  | { type: 'SET_NARRATION_MODE'; mode: VoiceNarration }
  | { type: 'SET_SHORTCUT_BINDING'; shortcut: ShortcutAction; chord: string }
  | { type: 'SET_TOOL_ACTIVITY'; settings: ToolActivitySettings };

// Loaded once at module scope so the theme loader can match saved colors
// against custom presets when recovering a missing presetId.
const initialCustomThemes = loadCustomThemes();

const persistedUiState = loadPersistedUiState();
const sessionSnapshot = loadSessionSnapshot();
const restoredTabStrip = loadTabStrip();
const restoresNewChat =
  (persistedUiState.mainView ?? 'session') === 'session' && !persistedUiState.activeAppSessionId;

/** A Settings destination: the Remote tab, opened at the username step. */
export interface SettingsRequest {
  tab: 'Remote';
  step: 'claim-username';
}

export interface AutomationEditorRequest {
  automationId: string;
  requestId: number;
}

let automationEditorRequestSequence = 0;

function createAutomationEditorRequest(automationId: string): AutomationEditorRequest {
  automationEditorRequestSequence += 1;
  return { automationId, requestId: automationEditorRequestSequence };
}

export const initialState: AppState = {
  connection: 'idle',
  sessions: sessionSnapshot?.sessions ?? {},
  sessionOrder: sessionSnapshot?.sessionOrder ?? [],
  projects: [],
  projectsLoaded: false,
  projectsError: '',
  listConfirmedSessionIds: sessionSnapshot?.listConfirmedSessionIds ?? null,
  earlierSessionsByCwd: {},
  revealEarlierCwds: persistedUiState.revealEarlierCwds ?? [],
  activeAppSessionId: persistedUiState.activeAppSessionId ?? null,
  sessionLastSeen: loadSessionLastSeen(),
  chatMetadata: loadChatMetadata(),
  transcripts: sessionSnapshot?.transcript
    ? { [sessionSnapshot.transcript.appSessionId]: sessionSnapshot.transcript.events }
    : {},
  transcriptMutations: {},
  transcriptRetainedCost: sessionSnapshot?.transcript
    ? {
        [sessionSnapshot.transcript.appSessionId]: estimateTranscriptCost(
          sessionSnapshot.transcript.events,
        ),
      }
    : {},
  transcriptViewportPinned: {},
  progress: {},
  childSessions: {},
  agentsWorkingByParent: {},
  historyLoaded: {},
  historyCursor: {},
  historyLoadingOlder: {},
  sessionRestore: {},
  childHistory: {},
  childAccess: {},
  childRuntime: {},
  pendingPermissions: {},
  pendingQuestions: {},
  contextStats: { primary: {}, child: {} },
  specPlans: {},
  sessionSpecs: {},
  specWikiAppSessionId: null,
  promptQueue: {},
  sessionNotes: loadSessionNotes(),
  agentProcesses: {},
  rightPanelOpen: persistedUiState.rightPanelOpen ?? true,
  utilityPanels: persistedUiState.utilityPanels ?? {},
  canvasAttachments: {},
  canvasChatRequests: {},
  chatModeAppSessionId: null,
  sidebarCollapsed: persistedUiState.sidebarCollapsed ?? false,
  mainView: persistedUiState.mainView ?? 'session',
  tabStrip: restoredTabStrip,
  automationEditorRequest: null,
  prWorkspaceCwd: persistedUiState.prWorkspaceCwd ?? null,
  prWorkspaceNumber: persistedUiState.prWorkspaceNumber ?? null,
  prBacklogIds: persistedUiState.prBacklogIds ?? [],
  specMode: persistedUiState.specMode ?? false,
  settingsOpen: false,
  settingsRequest: null,
  commandPaletteOpen: false,
  theme: loadTheme(initialCustomThemes),
  customThemes: initialCustomThemes,
  missionControlMode: persistedUiState.missionControlMode ?? false,
  draftChat: restoresNewChat ? activeTabDraft(restoredTabStrip) : null,
  defaultAutonomy: loadDefaultPermissionMode(),
  toolActivity: loadToolActivity(),
  draftAutonomy: null,
  draftFastMode: false,
  draftContextWindowTokens: null,
  pendingAutonomy: {},
  pendingModelUpdates: {},
  composerSeeds: [],
  workspaceCwds: loadWorkspaceCwds(),
  browsers: persistedUiState.browsers ?? {},
  browserErrors: {},
  browserGlobalError: undefined,
  designModes: {},
  voiceSessions: {},
  selectedFeatureId: persistedUiState.selectedFeatureId ?? null,
  selectedChild: null,
  models: [],
  providerStatuses: [],
  draftProvider: loadDraftProvider(),
  usage: {},
  compactionModel: loadCompactionModel(),
  compactionTokenLimit: loadCompactionTokenLimit(),
  compactionTokenLimitPerModel: loadCompactionTokenLimitPerModel(),
  compactionSettingsRev: 0,
  liveEnterBehavior: loadLiveEnterBehavior(),
  imagePasteQuality: loadImagePasteQuality(),
  defaultVoice: loadDefaultVoice(),
  knownVoices: loadKnownVoices(),
  narrationMode: loadNarrationMode(),
  shortcutBindings: loadShortcutBindings(),
  reviewOpenAppSessionId: null,
  reviewScope: loadReviewScope(),
  reviewFocusPath: null,
  reviewFocusChange: null,
  reviewFocusRequestId: 0,
  diffView: loadDiffView(),
  skills: [],
  skillsProviderSessionId: undefined,
  harnessModels: loadHarnessModels(),
  agentConfig: loadAgentConfig(),
  pendingCompose: {},
  heldComposeOrigins: {},
  lastCreatedSessionRequest: null,
  pendingForks: {},
  sideChats: {},
  sideChatDefaultPlacement: loadSideChatPlacement(),
};

function progressKey(entry: ProgressEntry): string {
  return `${entry.timestamp}|${entry.type}|${entry.featureId ?? ''}|${entry.workerChildSessionId ?? ''}|${entry.title ?? ''}`;
}

// A minimized side chat floats again and one on screen or still open stays put.
// Only a side chat that is not open yet, docked with no tab and no chat behind
// it, opens where Settings says.
function sideChatPlacementToShow(state: AppState, sourceAppSessionId: string): SideChatPlacement {
  const { placement } = sideChatPanel(state.sideChats, sourceAppSessionId);
  if (placement !== 'docked') return 'floating';
  const hasTab = utilityPanelForSession(state.utilityPanels, sourceAppSessionId).tabs.some(
    (tab) => tab.tool === 'side',
  );
  if (hasTab || currentSideChat(state.sessions, state.chatMetadata, sourceAppSessionId)) {
    return 'docked';
  }
  return state.sideChatDefaultPlacement;
}

function withoutKey<T>(
  record: Partial<Record<string, T>>,
  key: string,
): Partial<Record<string, T>> {
  if (!(key in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

// The action that closes the live chat's place, when that is `appSessionId`.
function closeLiveChat(state: AppState, appSessionId: string): TabAction | null {
  const live = livePage(state);
  if (live.kind === 'chat' && live.appSessionId === appSessionId) {
    return { type: 'CLOSE_TAB', tabId: state.tabStrip.activeTabId };
  }
  if (live.kind !== 'tiles') return null;
  const tile = focusedTile(live.grid);
  const shown = tile.page.kind === 'chat' && tile.page.appSessionId === appSessionId;
  return shown ? { type: 'CLOSE_TILE', tileId: tile.id } : null;
}

// The tiles beside the focused one are on screen too, so showing them reads them.
function withTilesSeen(state: AppState, seenAt: number): AppState {
  const seen = chatsBesideFocus(state.tabStrip).filter(
    (appSessionId) =>
      Object.hasOwn(state.sessions, appSessionId) && state.sessionLastSeen[appSessionId] !== seenAt,
  );
  if (seen.length === 0) return state;
  const sessionLastSeen = { ...state.sessionLastSeen };
  for (const appSessionId of seen) sessionLastSeen[appSessionId] = seenAt;
  return { ...state, sessionLastSeen };
}

// An archived or deleted chat leaves every tab, and cannot be reopened. The
// tab or tile showing it closes, as a browser tab does when its page goes away.
function withoutChatTabs(state: AppState, appSessionId: string): AppState {
  const close = closeLiveChat(state, appSessionId);
  const closed = close ? reducer(state, close) : state;
  const tabStrip = withoutChats(closed.tabStrip, (id) => id === appSessionId);
  const dropped = tabStrip === closed.tabStrip ? closed : { ...closed, tabStrip };
  // Deleting a chat removes its attachment, not its designs (spec §4). The
  // sidecar owns that removal; this only drops the cache that pointed at it,
  // any attachment still on its way to that chat, and its claim on Chat.
  const canvasChatRequests = withoutCanvasRequests(
    dropped.canvasChatRequests,
    (request) => request.appSessionId === appSessionId,
  );
  const chatModeAppSessionId =
    dropped.chatModeAppSessionId === appSessionId ? null : dropped.chatModeAppSessionId;
  const canvasAttachments =
    appSessionId in dropped.canvasAttachments
      ? Object.fromEntries(
          Object.entries(dropped.canvasAttachments).filter(([id]) => id !== appSessionId),
        )
      : dropped.canvasAttachments;
  if (
    canvasChatRequests === dropped.canvasChatRequests &&
    chatModeAppSessionId === dropped.chatModeAppSessionId &&
    canvasAttachments === dropped.canvasAttachments
  )
    return dropped;
  return { ...dropped, canvasAttachments, canvasChatRequests, chatModeAppSessionId };
}

/**
 * Tells one pane-opening request which chat its create made. Only that
 * request's entry moves; every other one keeps waiting for its own reply.
 */
function namedCanvasChatRequest(
  requests: Record<string, CanvasChatRequest>,
  clientRef: string,
  appSessionId: string,
): Record<string, CanvasChatRequest> {
  if (!(clientRef in requests)) return requests;
  const request = requests[clientRef];
  if (request.appSessionId !== null) return requests;
  return { ...requests, [clientRef]: { appSessionId } };
}

/** The pane requests left once the ones this names are settled. */
function withoutCanvasRequests(
  requests: Record<string, CanvasChatRequest>,
  settled: (request: CanvasChatRequest, clientRef: string) => boolean,
): Record<string, CanvasChatRequest> {
  const remaining = Object.entries(requests).filter(
    ([clientRef, request]) => !settled(request, clientRef),
  );
  if (remaining.length === Object.keys(requests).length) return requests;
  return Object.fromEntries(remaining);
}

export function reducer(state: AppState, action: Action): AppState {
  const next = withoutLeftDrafts(reduceAction(state, action));
  if (
    next.utilityPanels === state.utilityPanels &&
    next.activeAppSessionId === state.activeAppSessionId
  )
    return next;
  const parentAppSessionId = state.activeAppSessionId;
  if (!parentAppSessionId) return next;
  const panel = Object.hasOwn(state.utilityPanels, parentAppSessionId)
    ? state.utilityPanels[parentAppSessionId]
    : undefined;
  if (!panel?.open) return next;
  const childSessionId = panel.tabs.find(
    (tab) => tab.id === panel.activeTabId && tab.tool === 'agents',
  )?.agentId;
  if (
    !childSessionId ||
    (next.selectedChild?.parentAppSessionId === parentAppSessionId &&
      next.selectedChild.childSessionId === childSessionId)
  )
    return next;
  return releaseInactiveChildTranscript(next, parentAppSessionId, childSessionId);
}

// A draft's seeds and its sent compose wait in its tile. Once the tile closes or
// shows something else, that draft is gone: its seeds are dropped and its
// compose forgets the tile, so neither reaches a later draft there.
function withoutLeftDrafts(state: AppState): AppState {
  const waiting = [
    ...state.composerSeeds.map((seed) => seed.draftTileId),
    ...Object.values(state.pendingCompose).map((compose) => compose?.origin?.tileId),
    ...Object.values(state.heldComposeOrigins).map((origin) => origin?.tileId),
  ];
  if (!waiting.some(Boolean)) return state;
  const drafts = draftTileIds(state);
  const left = new Set(waiting.filter((tileId) => tileId && !drafts.includes(tileId)));
  if (left.size === 0) return state;
  let next: AppState = {
    ...state,
    composerSeeds: state.composerSeeds.filter((seed) => !left.has(seed.draftTileId)),
  };
  for (const tileId of left) if (tileId) next = { ...next, ...withComposeTileClosed(next, tileId) };
  return next;
}

function reduceAction(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'BATCH':
      return reduceStoreActionBatch(state, action.actions, reducer);

    case 'SET_CONNECTION': {
      if (action.status === 'connected')
        return { ...state, connection: action.status, connectionError: action.message };
      const next = invalidateSelectedChildOpening(state);
      // A lost bridge never answers a fork either; a side chat still starting
      // hands its question back to the composer.
      let sideChats = next.sideChats;
      for (const [clientRef, fork] of Object.entries(next.pendingForks)) {
        if (fork?.kind === 'side') sideChats = settleSideChatStart(sideChats, clientRef, null);
      }
      return {
        ...next,
        pendingForks: {},
        sideChats,
        connection: action.status,
        connectionError: action.message,
        selectedChild: null,
        childAccess: {},
        childRuntime: {},
        agentProcesses: {},
        // A lost bridge never settles in-flight changes, so fall back to the last confirmed values.
        pendingModelUpdates: {},
        contextStats: { ...next.contextStats, child: {} },
      };
    }

    case 'SESSION_CREATED': {
      const pending = state.pendingCompose[action.clientRef];
      // `session.created` is also emitted when an existing session resumes.
      // Only a create matching this renderer's pending compose may take focus;
      // background resumes must never replace the chat the user selected. A
      // side chat opens beside its source, never in its place. A create sent
      // from a tab or tile the user has since left opens there instead.
      const ownsCreate = pending !== undefined && action.session.lineage?.kind !== 'side';
      const sessions = { ...state.sessions, [action.session.appSessionId]: action.session };
      // A design send's chat opens as a design from now on, in every window,
      // and is placed as one.
      const chatMetadata =
        ownsCreate && action.clientRef in state.canvasChatRequests
          ? (markDesignChat(state.chatMetadata, action.session.appSessionId) ?? state.chatMetadata)
          : state.chatMetadata;
      const placed = ownsCreate
        ? placeCreatedChat(
            { ...state, sessions, chatMetadata },
            pending.origin,
            action.session.appSessionId,
          )
        : null;
      const shouldActivate = placed?.focus === true;
      const tabStrip = placed?.tabStrip ?? state.tabStrip;
      const targetIsActive = state.activeAppSessionId === action.session.appSessionId;
      const childReset =
        shouldActivate || targetIsActive ? invalidateSelectedChildOpening(state) : state;
      const childAccess = { ...childReset.childAccess };
      const childRuntime = { ...childReset.childRuntime };
      delete childAccess[action.session.appSessionId];
      delete childRuntime[action.session.appSessionId];
      const order = state.sessionOrder.includes(action.session.appSessionId)
        ? state.sessionOrder
        : [action.session.appSessionId, ...state.sessionOrder];

      // Seed the first user message: the goal is the user's opening prompt and the
      // backend never echoes it back, so without this the first message never shows.
      let seed: TranscriptEvent | undefined;
      const hasTranscript =
        (lookup(state.transcripts, action.session.appSessionId)?.length ?? 0) > 0;
      if (action.session.goal && !hasTranscript) {
        seed = {
          id: `seed-${action.session.appSessionId}`,
          appSessionId: action.session.appSessionId,
          sourceSessionId: 'user',
          role: 'primary',
          ts: action.session.createdAt || Date.now(),
          kind: 'text',
          text: pending ? pending.text : action.session.goal,
          author: 'user',
          skills: pending?.skills.length ? pending.skills : undefined,
          // Only a compose owned by this renderer is live metadata. A seed from
          // another window or a resumed session is restored-equivalent content.
          files: pending?.files,
        };
      }

      const pendingCompose = withoutKey(state.pendingCompose, action.clientRef);
      // Seeds that arrived for the draft while it was sent go to the chat it became.
      const draftTileId = ownsCreate ? pending.origin?.tileId : undefined;
      const composerSeeds = draftTileId
        ? state.composerSeeds.map((pendingSeed) =>
            pendingSeed.draftTileId === draftTileId
              ? { ...pendingSeed, appSessionId: action.session.appSessionId, draftTileId: null }
              : pendingSeed,
          )
        : state.composerSeeds;

      const next: AppState = {
        ...childReset,
        sessions,
        sessionOrder: order,
        tabStrip,
        activeAppSessionId: shouldActivate ? action.session.appSessionId : state.activeAppSessionId,
        draftChat: shouldActivate ? null : state.draftChat,
        draftAutonomy: shouldActivate ? null : state.draftAutonomy,
        draftFastMode: shouldActivate ? false : state.draftFastMode,
        draftContextWindowTokens: shouldActivate ? null : state.draftContextWindowTokens,
        selectedChild: shouldActivate || targetIsActive ? null : childReset.selectedChild,
        // A pending review-focus request belongs to the session that issued
        // it; a different session becoming active must not inherit it.
        reviewFocusPath:
          shouldActivate && action.session.appSessionId !== state.activeAppSessionId
            ? null
            : state.reviewFocusPath,
        reviewFocusChange:
          shouldActivate && action.session.appSessionId !== state.activeAppSessionId
            ? null
            : state.reviewFocusChange,
        childAccess,
        childRuntime,
        pendingCompose,
        composerSeeds,
        pendingForks: withoutKey(state.pendingForks, action.clientRef),
        sideChats:
          state.pendingForks[action.clientRef]?.kind === 'side'
            ? settleSideChatStart(state.sideChats, action.clientRef, action.session.appSessionId)
            : state.sideChats,
        lastCreatedSessionRequest: shouldActivate
          ? { clientRef: action.clientRef, appSessionId: action.session.appSessionId }
          : state.lastCreatedSessionRequest,
        // This create's own pane request, if it had one, now knows the chat
        // it opens on. Another create in flight keeps its own target.
        canvasChatRequests: namedCanvasChatRequest(
          state.canvasChatRequests,
          action.clientRef,
          action.session.appSessionId,
        ),
        chatMetadata,
        // A foreground chat just created by this renderer is already seen. A
        // chat this client just learned of starts seen at its creation, so its
        // first reply reads as unread.
        sessionLastSeen:
          shouldActivate || !Object.hasOwn(state.sessionLastSeen, action.session.appSessionId)
            ? {
                ...state.sessionLastSeen,
                [action.session.appSessionId]: action.session.updatedAt,
              }
            : state.sessionLastSeen,
      };
      return seed
        ? withUpdatedTranscript(
            next,
            action.session.appSessionId,
            [seed],
            estimateTranscriptCost([seed]),
            {
              mutation: { kind: 'append', previousLength: 0, firstChangedIndex: 0 },
            },
          )
        : next;
    }

    case 'FORK_REQUESTED':
      return {
        ...state,
        pendingForks: {
          ...state.pendingForks,
          [action.clientRef]: action.fork,
        },
      };

    // A same-harness copy arrives stored and closed. It carries its source's
    // transcript on disk; only a first message the sidecar is about to send
    // needs seeding, since the backend never echoes it back.
    case 'SESSION_FORKED': {
      const pending = state.pendingForks[action.clientRef];
      const appSessionId = action.session.appSessionId;
      let next: AppState = {
        ...state,
        sessions: { ...state.sessions, [appSessionId]: action.session },
        sessionOrder: state.sessionOrder.includes(appSessionId)
          ? state.sessionOrder
          : [appSessionId, ...state.sessionOrder],
        pendingForks: withoutKey(state.pendingForks, action.clientRef),
        sideChats:
          pending?.kind === 'side'
            ? settleSideChatStart(state.sideChats, action.clientRef, appSessionId)
            : state.sideChats,
      };
      if (pending?.prompt) {
        const seed: TranscriptEvent = {
          id: `seed-${appSessionId}`,
          appSessionId,
          sourceSessionId: 'user',
          role: 'primary',
          ts: action.session.lineage?.forkedAt ?? action.session.updatedAt,
          kind: 'text',
          text: pending.prompt,
          author: 'user',
        };
        next = appendTranscriptEvent(next, seed);
      }
      if (!pending || action.session.lineage?.kind !== 'fork') return next;
      return reducer(next, { type: 'SET_ACTIVE_SESSION', id: appSessionId });
    }

    case 'SHOW_SIDE_CHAT': {
      const { sourceAppSessionId } = action;
      const next: AppState = {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, { view: action.view }),
      };
      return reducer(next, {
        type: 'PLACE_SIDE_CHATS',
        sourceAppSessionId,
        placement: sideChatPlacementToShow(state, sourceAppSessionId),
      });
    }

    // Docking moves the side chats into the utility pane; floating or
    // minimizing takes them out of it, so they are never shown twice.
    case 'PLACE_SIDE_CHATS': {
      const { sourceAppSessionId, placement } = action;
      const next: AppState = {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, { placement }),
      };
      if (placement === 'docked') {
        if (sourceAppSessionId !== state.activeAppSessionId) return next;
        return reducer(next, { type: 'OPEN_UTILITY_TOOL', tool: 'side' });
      }
      return {
        ...next,
        utilityPanels: {
          ...state.utilityPanels,
          [sourceAppSessionId]: removeUtilityTool(state.utilityPanels[sourceAppSessionId], 'side'),
        },
      };
    }

    // A closed side chat rests docked with no tab, which is off screen; the
    // next `/side` opens it where Settings says.
    case 'CLOSE_SIDE_CHAT': {
      const { sourceAppSessionId, appSessionId } = action;
      const chatMetadata = appSessionId
        ? deleteChat(state.chatMetadata, appSessionId, Date.now())
        : null;
      return {
        ...state,
        chatMetadata: chatMetadata ?? state.chatMetadata,
        sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, {
          view: { kind: 'current' },
          placement: 'docked',
        }),
        utilityPanels: {
          ...state.utilityPanels,
          [sourceAppSessionId]: removeUtilityTool(state.utilityPanels[sourceAppSessionId], 'side'),
        },
      };
    }

    case 'SET_SIDE_CHAT_DEFAULT_PLACEMENT':
      return {
        ...state,
        sideChatDefaultPlacement: action.placement,
      };

    case 'CHOOSE_SIDE_CHAT_HARNESS':
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          harness: action.harness,
        }),
      };

    case 'ATTACH_SIDE_CHAT_REPLY': {
      const { attachedReplies = [] } = sideChatPanel(state.sideChats, action.sourceAppSessionId);
      if (attachedReplies.includes(action.reply)) return state;
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          attachedReplies: [...attachedReplies, action.reply],
        }),
      };
    }

    case 'DETACH_SIDE_CHAT_REPLIES': {
      const attachedReplies = state.sideChats[action.sourceAppSessionId]?.attachedReplies;
      if (!attachedReplies) return state;
      // Only the sent replies go; one attached while the prompt was in flight stays.
      const remaining = attachedReplies.filter((reply) => !action.replies.includes(reply));
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          attachedReplies: remaining.length > 0 ? remaining : undefined,
        }),
      };
    }

    case 'SET_PENDING_COMPOSE':
      return {
        ...state,
        pendingCompose: {
          ...state.pendingCompose,
          [action.clientRef]: {
            text: action.text,
            skills: action.skills,
            files: action.files,
            origin:
              action.originHoldId === null
                ? null
                : (state.heldComposeOrigins[action.originHoldId] ?? null),
          },
        },
        canvasChatRequests: action.canvas
          ? {
              ...state.canvasChatRequests,
              [action.clientRef]: { appSessionId: null },
            }
          : state.canvasChatRequests,
      };
    case 'HOLD_COMPOSE_ORIGIN':
      return {
        ...state,
        heldComposeOrigins: {
          ...state.heldComposeOrigins,
          [action.holdId]: composeOrigin(state.tabStrip),
        },
      };
    case 'RELEASE_COMPOSE_ORIGIN':
      return {
        ...state,
        heldComposeOrigins: withoutKey(state.heldComposeOrigins, action.holdId),
      };

    case 'SESSION_UPDATED': {
      const previous = lookup(state.sessions, action.session.appSessionId);
      const incoming = action.session;
      // Compaction generations are monotonic. A delayed resume summary must not
      // put a restored session back on generation zero after history already
      // proved that compactions occurred.
      const m =
        previous && (previous.autoCompactions ?? 0) > (incoming.autoCompactions ?? 0)
          ? {
              ...incoming,
              autoCompactions: previous.autoCompactions,
              contextTokens: previous.contextTokens,
              contextRemainingTokens: previous.contextRemainingTokens,
              contextAccuracy: previous.contextAccuracy,
              contextUpdatedAt: previous.contextUpdatedAt,
            }
          : incoming;
      const previousCompactions =
        (previous?.compactedFromProviderSessionIds?.length ?? 0) + (previous?.autoCompactions ?? 0);
      const nextCompactions =
        (m.compactedFromProviderSessionIds?.length ?? 0) + (m.autoCompactions ?? 0);
      const contextStats =
        nextCompactions > previousCompactions
          ? {
              ...state.contextStats,
              primary: Object.fromEntries(
                Object.entries(state.contextStats.primary).filter(
                  ([appSessionId]) => appSessionId !== m.appSessionId,
                ),
              ),
            }
          : state.contextStats;
      const inView = isChatInView(state, m.appSessionId);
      // The active chat is never unread; a tile beside it is read as it changes.
      const seenInTile =
        inView &&
        m.appSessionId !== state.activeAppSessionId &&
        m.updatedAt > (state.sessionLastSeen[m.appSessionId] ?? 0);
      const next = {
        ...state,
        sessions: { ...state.sessions, [m.appSessionId]: m },
        contextStats,
        sessionLastSeen: seenInTile
          ? { ...state.sessionLastSeen, [m.appSessionId]: m.updatedAt }
          : state.sessionLastSeen,
      };
      if (
        !previous ||
        !sessionIsLive(previous) ||
        sessionIsLive(m) ||
        m.updatedAt <= previous.updatedAt ||
        inView ||
        state.transcriptViewportPinned[m.appSessionId] === false
      )
        return next;
      return releaseSessionTranscriptWindow(next, m.appSessionId, INACTIVE_TRANSCRIPT_POLICY);
    }

    case 'PROJECTS_SNAPSHOT':
      return { ...state, projects: action.projects, projectsLoaded: true, projectsError: '' };

    case 'PROJECTS_UNAVAILABLE':
      return { ...state, projectsLoaded: true, projectsError: action.message };

    case 'SESSIONS_PROCESSES':
      return { ...state, agentProcesses: action.processes };
    case 'SESSION_PROCESSES': {
      if (action.processes.length === 0 && !(action.appSessionId in state.agentProcesses))
        return state;
      const agentProcesses =
        action.processes.length === 0
          ? Object.fromEntries(
              Object.entries(state.agentProcesses).filter(([id]) => id !== action.appSessionId),
            )
          : { ...state.agentProcesses, [action.appSessionId]: action.processes };
      return { ...state, agentProcesses };
    }

    case 'SESSION_CLOSED': {
      const childAccess = { ...state.childAccess };
      const childRuntime = { ...state.childRuntime };
      const childContext = { ...state.contextStats.child };
      delete childAccess[action.appSessionId];
      delete childRuntime[action.appSessionId];
      delete childContext[action.appSessionId];
      return {
        ...state,
        childAccess,
        childRuntime,
        pendingPermissions: Object.fromEntries(
          Object.entries(state.pendingPermissions).filter(([id]) => id !== action.appSessionId),
        ),
        pendingQuestions: Object.fromEntries(
          Object.entries(state.pendingQuestions).filter(([id]) => id !== action.appSessionId),
        ),
        contextStats: { ...state.contextStats, child: childContext },
        pendingAutonomy: Object.fromEntries(
          Object.entries(state.pendingAutonomy).filter(([id]) => id !== action.appSessionId),
        ),
        pendingModelUpdates: Object.fromEntries(
          Object.entries(state.pendingModelUpdates).filter(([id]) => id !== action.appSessionId),
        ),
        agentProcesses: Object.fromEntries(
          Object.entries(state.agentProcesses).filter(([id]) => id !== action.appSessionId),
        ),
        voiceSessions: withoutVoiceSession(state.voiceSessions, action.appSessionId),
        selectedChild:
          state.selectedChild?.parentAppSessionId === action.appSessionId
            ? null
            : state.selectedChild,
      };
    }

    // Chat organization transforms return null for no-ops so these cases keep
    // the current state untouched (no re-render, no storage write).
    case 'LINK_CHATS_PR': {
      const sessions: Partial<AppState['sessions']> = state.sessions;
      const ids = action.appSessionIds.filter((id) => sessions[id]?.cwd === action.cwd);
      const chatMetadata = linkChatsPullRequest(
        state.chatMetadata,
        ids,
        action.pr,
        state.activeAppSessionId,
      );
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'RENAME_CHAT': {
      const chatMetadata = renameChat(state.chatMetadata, action.appSessionId, action.title);
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'SET_CHAT_METADATA':
      return { ...state, chatMetadata: action.chatMetadata };

    case 'PIN_CHAT': {
      const chatMetadata = pinChat(state.chatMetadata, action.appSessionId, Date.now());
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'MARK_DESIGN_CHAT': {
      const chatMetadata = markDesignChat(state.chatMetadata, action.appSessionId);
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'UNPIN_CHAT': {
      const chatMetadata = unpinChat(state.chatMetadata, action.appSessionId);
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'ARCHIVE_CHAT': {
      const chatMetadata = archiveChat(state.chatMetadata, action.appSessionId, Date.now());
      const utilityPanels = removeSessionPanel(state.utilityPanels, action.appSessionId);
      const archived =
        chatMetadata || utilityPanels !== state.utilityPanels
          ? { ...state, chatMetadata: chatMetadata ?? state.chatMetadata, utilityPanels }
          : state;
      return withoutChatTabs(archived, action.appSessionId);
    }

    case 'RESTORE_CHAT': {
      const chatMetadata = restoreChat(state.chatMetadata, action.appSessionId);
      return chatMetadata ? { ...state, chatMetadata } : state;
    }

    case 'DELETE_CHAT': {
      // SESSION_CLOSED does not prune panels because sidecar retires idle runtimes while
      // chats and their PTYs remain live; only explicit deletion/archival cleans up panels.
      const chatMetadata = deleteChat(state.chatMetadata, action.appSessionId, Date.now());
      const utilityPanels = removeSessionPanel(state.utilityPanels, action.appSessionId);
      const deleted =
        chatMetadata || utilityPanels !== state.utilityPanels
          ? { ...state, chatMetadata: chatMetadata ?? state.chatMetadata, utilityPanels }
          : state;
      return withoutChatTabs(deleted, action.appSessionId);
    }

    case 'SESSION_FEATURES': {
      const mid = action.appSessionId;
      const existing = lookup(state.sessions, mid);
      if (!existing) return state;
      return {
        ...state,
        sessions: { ...state.sessions, [mid]: { ...existing, features: action.features } },
      };
    }

    case 'SESSION_PROGRESS': {
      const mid = action.appSessionId;
      const prev = state.progress[mid] ?? [];
      const seen = new Set(prev.map(progressKey));
      const next = [...prev];
      action.entries.forEach((entry) => {
        const key = progressKey(entry);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(entry);
      });
      return {
        ...state,
        progress: { ...state.progress, [mid]: next },
      };
    }

    case 'SESSION_CHILD':
      return reduceSessionChildren(state, [action]);

    case 'CHILD_UPDATED':
      return reduceChildUpdated(state, action);

    case 'CHILD_ERROR':
      return reduceChildError(state, action);

    case 'SESSION_TOKENS': {
      const mid = action.appSessionId;
      const existing = lookup(state.sessions, mid);
      if (!existing) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [mid]: {
            ...existing,
            tokensIn: action.tokensIn,
            tokensOut: action.tokensOut,
            contextTokens: action.contextTokens,
            maxContextTokens: action.maxContextTokens ?? existing.maxContextTokens,
          },
        },
      };
    }

    case 'CONTEXT_UPDATED': {
      const existing = lookup(state.sessions, action.appSessionId);
      if (action.parentAppSessionId && action.childSessionId) {
        const parent = state.contextStats.child[action.parentAppSessionId] ?? {};
        return {
          ...state,
          contextStats: {
            ...state.contextStats,
            child: {
              ...state.contextStats.child,
              [action.parentAppSessionId]: {
                ...parent,
                [action.childSessionId]: action.stats,
              },
            },
          },
        };
      }
      return {
        ...state,
        contextStats: {
          ...state.contextStats,
          primary: { ...state.contextStats.primary, [action.appSessionId]: action.stats },
        },
        sessions: existing
          ? {
              ...state.sessions,
              [action.appSessionId]: {
                ...existing,
                contextTokens: action.stats.used,
                contextRemainingTokens: action.stats.remaining,
                maxContextTokens: action.stats.limit,
                contextAccuracy: action.stats.accuracy,
                contextUpdatedAt: action.stats.updatedAt,
              },
            }
          : state.sessions,
      };
    }

    case 'SESSION_TRANSCRIPT':
      return appendTranscriptEvent(state, action.event);

    case 'TRANSCRIPT_VIEWPORT':
      return state.transcriptViewportPinned[action.appSessionId] === action.pinned
        ? state
        : {
            ...state,
            transcriptViewportPinned: {
              ...state.transcriptViewportPinned,
              [action.appSessionId]: action.pinned,
            },
          };

    case 'TRANSCRIPT_RELEASE_VIEWPORT': {
      if (!isChatInView(state, action.appSessionId)) return state;
      if (state.transcriptViewportPinned[action.appSessionId] === false) return state;
      const session = lookup(state.sessions, action.appSessionId);
      if (!session || sessionIsLive(session)) return state;
      return releaseSessionTranscriptWindow(state, action.appSessionId, VIEWPORT_TRANSCRIPT_POLICY);
    }

    case 'MEMORY_PRESSURE':
      return applyMemoryPressureRelease(state);

    case 'CHILD_TRANSCRIPT_VIEWPORT':
      return reduceChildTranscriptViewport(state, action);

    case 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT':
      return reduceChildTranscriptReleaseViewport(state, action);

    case 'QUEUE_PROMPT': {
      const prev = state.promptQueue[action.appSessionId] ?? [];
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [action.appSessionId]: [...prev, action.prompt] },
      };
    }

    case 'REMOVE_QUEUED_PROMPT': {
      const prev = state.promptQueue[action.appSessionId] ?? [];
      return {
        ...state,
        promptQueue: {
          ...state.promptQueue,
          [action.appSessionId]: prev.filter((p) => p.id !== action.id),
        },
      };
    }

    case 'REORDER_QUEUE': {
      const prev = state.promptQueue[action.appSessionId] ?? [];
      if (
        action.from === action.to ||
        action.from < 0 ||
        action.to < 0 ||
        action.from >= prev.length ||
        action.to >= prev.length
      ) {
        return state;
      }
      const next = [...prev];
      const [moved] = next.splice(action.from, 1);
      next.splice(action.to, 0, moved);
      return { ...state, promptQueue: { ...state.promptQueue, [action.appSessionId]: next } };
    }

    case 'SPEC_SET':
    case 'SPEC_OPEN_WIKI':
    case 'SPEC_CLOSE_WIKI':
    case 'SESSION_PERMISSION':
    case 'SESSION_QUESTION':
    case 'CLEAR_PERMISSION':
    case 'CLEAR_QUESTION':
    case 'CLEAR_INTERACTION':
    case 'TOGGLE_SPEC_MODE':
    case 'SESSION_SET_INTERACTION_MODE':
      return reduceSessionInteractions(state, action);

    case 'SESSION_CREATE_FAILED':
      return {
        ...state,
        // No chat was made, so the canvas this prompt asked for is cancelled.
        canvasChatRequests: withoutCanvasRequests(
          state.canvasChatRequests,
          (_request, clientRef) => clientRef === action.clientRef,
        ),
        pendingCompose: withoutKey(state.pendingCompose, action.clientRef),
        pendingForks: withoutKey(state.pendingForks, action.clientRef),
        sideChats: settleSideChatStart(state.sideChats, action.clientRef, null),
        lastCreatedSessionRequest:
          state.lastCreatedSessionRequest?.clientRef === action.clientRef
            ? null
            : state.lastCreatedSessionRequest,
      };

    case 'SESSION_ERROR': {
      if (!action.appSessionId) return state;
      const m = lookup(state.sessions, action.appSessionId);
      if (!m) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.appSessionId]: { ...m, phase: 'failed' },
        },
      };
    }

    case 'SESSION_LIST': {
      const incoming = new Set(action.sessions.map((m) => m.appSessionId));
      // The catalog retains admitted owned chats with unavailable transcripts.
      // Only an omitted catalog record can prune a confirmed row; locally
      // added rows survive until their first catalog listing.
      const confirmed = new Set(state.listConfirmedSessionIds);
      const isConfirmedGone = (id: string) => confirmed.has(id) && !incoming.has(id);
      const map: Record<string, SessionSummary> = {};
      for (const [id, summary] of Object.entries(state.sessions)) {
        if (isConfirmedGone(id)) continue;
        map[id] = summary;
      }
      for (const m of action.sessions) {
        map[m.appSessionId] = m;
      }
      const order = [
        ...new Set([
          ...action.sessions.map((m) => m.appSessionId),
          ...state.sessionOrder,
          ...Object.keys(state.sessions),
        ]),
      ]
        .filter((id) => lookup(map, id))
        .sort((a, b) => map[b].updatedAt - map[a].updatedAt);
      const retainedSessionIds = new Set(Object.keys(map));
      const retainedState = pruneRemovedSessionState(state, retainedSessionIds);
      // Seed last-seen for sessions this client has never tracked so existing
      // history is not retroactively marked unread; only activity that arrives
      // after this point (a newer updatedAt) flips a row to unread.
      const seededLastSeen = { ...retainedState.sessionLastSeen };
      for (const m of action.sessions) {
        if (lookup(seededLastSeen, m.appSessionId) === undefined) {
          seededLastSeen[m.appSessionId] = m.updatedAt;
        }
      }
      // If the active session was pruned above (a hydrated snapshot row the
      // sidecar no longer reports), clear the dangling id so the UI does not
      // point at a session that no longer exists.
      const activeAppSessionId =
        state.activeAppSessionId !== null && lookup(map, state.activeAppSessionId) !== undefined
          ? state.activeAppSessionId
          : null;
      // Catalog omission cannot prove a hidden chat will never return.
      // Keep its renderer-only tombstone; prune only orphaned preferences.
      let chatMetadata = state.chatMetadata;
      const orphaned = Object.keys(chatMetadata).filter(
        (id) => isConfirmedGone(id) && !isChatHidden(chatMetadata[id]),
      );
      if (orphaned.length > 0) {
        const drop = new Set(orphaned);
        chatMetadata = Object.fromEntries(
          Object.entries(chatMetadata).filter(([id]) => !drop.has(id)),
        );
      }
      const listed: AppState = {
        ...retainedState,
        sessions: map,
        sessionOrder: order,
        sessionLastSeen: seededLastSeen,
        chatMetadata,
        listConfirmedSessionIds: action.sessions.map((m) => m.appSessionId),
        earlierSessionsByCwd: action.earlierSessionsByCwd,
        activeAppSessionId,
        // The list covers every folder in the sidebar, so a restored tab whose
        // chat neither it nor the snapshot knows has nothing to show.
        tabStrip: withoutChats(state.tabStrip, (id) => lookup(map, id) === undefined),
      };
      // A focused tile whose chat is gone closes like any other, so the tile
      // beside it comes forward instead of a second new chat.
      const goneTile =
        state.activeAppSessionId !== null && activeAppSessionId === null
          ? closeLiveChat(state, state.activeAppSessionId)
          : null;
      return goneTile?.type === 'CLOSE_TILE' ? reducer(listed, goneTile) : listed;
    }

    case 'SESSION_HISTORY_LOADING_OLDER':
      return reduceSessionHistoryLoadingOlder(state, action);

    case 'CHILD_HISTORY_LOADING':
      return reduceChildHistoryLoading(state, action);

    case 'CHILD_HISTORY_LOADING_OLDER':
      return reduceChildHistoryLoadingOlder(state, action);

    case 'SESSION_RESTORE_START':
      return reduceSessionRestoreStart(state, action);

    case 'SESSION_HISTORY_FAILED':
      return reduceSessionHistoryFailed(state, action);

    case 'SESSION_HISTORY':
      return reduceSessionHistory(state, action);

    case 'SET_ACTIVE_SESSION': {
      // Stamp "seen now" on both the session being left (so responses received
      // while it was open count as read) and the one being opened (clears its
      // unread state immediately).
      const now = Date.now();
      const sessionLastSeen = { ...state.sessionLastSeen };
      if (state.activeAppSessionId && lookup(state.sessions, state.activeAppSessionId)) {
        sessionLastSeen[state.activeAppSessionId] = now;
      }
      if (action.id) sessionLastSeen[action.id] = now;
      const tabStrip = action.id ? showChat(state, action.id) : showNewChat(state, null);
      let next = invalidateSelectedChildOpening(releaseInactiveSelectedChild(state));
      const outgoingAppSessionId = state.activeAppSessionId;
      const outgoingSession = outgoingAppSessionId
        ? lookup(state.sessions, outgoingAppSessionId)
        : undefined;
      if (
        outgoingAppSessionId &&
        outgoingSession &&
        !sessionIsLive(outgoingSession) &&
        state.transcriptViewportPinned[outgoingAppSessionId] !== false &&
        // A chat left for another tile stays on screen.
        !isChatInView(
          { mainView: 'session', activeAppSessionId: action.id, tabStrip },
          outgoingAppSessionId,
        )
      ) {
        next = releaseSessionTranscriptWindow(
          next,
          outgoingAppSessionId,
          INACTIVE_TRANSCRIPT_POLICY,
        );
      }
      return withTilesSeen(
        {
          ...next,
          activeAppSessionId: action.id,
          sessionLastSeen,
          draftChat: null,
          draftAutonomy: null,
          draftFastMode: false,
          draftContextWindowTokens: null,
          selectedChild: null,
          // A pending review-focus request belongs to the session that issued
          // it; never let it fire in another session's panel after a switch.
          reviewFocusPath: action.id === state.activeAppSessionId ? state.reviewFocusPath : null,
          reviewFocusChange:
            action.id === state.activeAppSessionId ? state.reviewFocusChange : null,
          mainView: 'session',
          automationEditorRequest: null,
          tabStrip,
        },
        now,
      );
    }

    case 'MARK_ALL_SESSIONS_READ': {
      const sessionLastSeen = { ...state.sessionLastSeen };
      let changed = false;
      for (const appSessionId of state.sessionOrder) {
        const session = lookup(state.sessions, appSessionId);
        // Persisted renderer state can briefly contain an order entry whose
        // session was already removed.
        if (!session) continue;
        const seenAt = Math.max(action.seenAt, session.updatedAt);
        if (sessionLastSeen[appSessionId] === seenAt) continue;
        sessionLastSeen[appSessionId] = seenAt;
        changed = true;
      }
      return changed ? { ...state, sessionLastSeen } : state;
    }

    case 'SET_RIGHT_PANEL':
    case 'OPEN_UTILITY_TOOL':
    case 'CLOSE_UTILITY_TAB':
    case 'ACTIVATE_UTILITY_TAB':
    case 'UPDATE_UTILITY_TAB':
    case 'SET_UTILITY_PANEL_OPEN':
    case 'SET_REVIEW_OPEN':
    case 'SET_REVIEW_SCOPE':
    case 'OPEN_REVIEW_AT':
    case 'CLEAR_REVIEW_FOCUS':
    case 'SET_DIFF_VIEW':
    case 'TOGGLE_BROWSER':
    case 'SET_BROWSER_OPEN':
    case 'BROWSER_UPDATED':
    case 'BROWSER_NAVIGATED':
    case 'BROWSER_CLOSED':
    case 'BROWSER_ERROR':
    case 'TOGGLE_DESIGN_MODE':
    case 'SET_DESIGN_MODE':
      return reduceUtilityPanels(state, action);

    case 'SET_CANVAS_ATTACHMENT': {
      const { appSessionId, canvasId } = action;
      if (state.listConfirmedSessionIds !== null && !(appSessionId in state.sessions)) return state;
      if (state.canvasAttachments[appSessionId] === canvasId) return state;
      return {
        ...state,
        canvasAttachments: { ...state.canvasAttachments, [appSessionId]: canvasId },
      };
    }

    case 'CANVAS_CHAT_SETTLED': {
      const canvasChatRequests = withoutCanvasRequests(
        state.canvasChatRequests,
        (request) => request.appSessionId === action.appSessionId,
      );
      if (canvasChatRequests === state.canvasChatRequests) return state;
      return { ...state, canvasChatRequests };
    }

    // The switch turns the focused place into the other product. Design
    // remembers the chat it replaced; Chat goes back to it, or to a new chat.
    case 'SET_PRODUCT_MODE': {
      if (activeProduct(state) === action.mode) return state;
      if (action.mode === 'design') {
        return reducer(
          { ...state, chatModeAppSessionId: state.activeAppSessionId },
          { type: 'START_CHAT', ...newDraft(state, 'design') },
        );
      }
      const target = state.chatModeAppSessionId;
      const chat: AppState = { ...state, chatModeAppSessionId: null };
      if (target !== null && target in state.sessions) {
        return reducer(chat, { type: 'SET_ACTIVE_SESSION', id: target });
      }
      return reducer(chat, { type: 'START_CHAT', ...newDraft(state, 'chat') });
    }

    // The new-chat home's switch changes what its draft starts, in place: the
    // composer and what was typed stay put, and no earlier chat is returned to.
    case 'SET_DRAFT_PRODUCT': {
      if (state.activeAppSessionId !== null || activeProduct(state) === action.mode) return state;
      return reducer(
        { ...state, chatModeAppSessionId: null },
        { type: 'START_CHAT', ...newDraft(state, action.mode) },
      );
    }

    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen };

    case 'CLOSE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: false };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'TOGGLE_SETTINGS':
      return { ...state, settingsOpen: !state.settingsOpen, settingsRequest: null };

    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true, settingsRequest: action.request };

    case 'TOGGLE_MISSION_CONTROL':
      return { ...state, missionControlMode: !state.missionControlMode };

    case 'VOICE_CONNECTING':
    case 'VOICE_ANSWERED':
    case 'VOICE_STATE':
    case 'VOICE_ERROR':
    case 'VOICE_ENDED':
      return reduceVoice(state, action);

    // Settings has no conversation to ask what the harness offers, so what it
    // offers is what the harness last answered here.
    case 'VOICE_VOICES': {
      const next = reduceVoice(state, action);
      if (sameVoices(state.knownVoices, action.voices)) return next;
      return { ...next, knownVoices: action.voices };
    }

    case 'VOICE_TRANSCRIPT':
      return reduceVoice(state, action);

    case 'OPEN_PULL_REQUESTS':
      return {
        ...reducePrInbox(state, action),
        automationEditorRequest: null,
        tabStrip: showView(state, { kind: 'pull-requests' }),
      };
    case 'CLOSE_PULL_REQUESTS':
    case 'MOVE_PR_TO_BACKLOG':
    case 'RESTORE_PR_FROM_BACKLOG': {
      const next = reducePrInbox(state, action);
      return next.mainView === 'automations' || !state.automationEditorRequest
        ? next
        : { ...next, automationEditorRequest: null };
    }

    case 'OPEN_PROJECTS':
      return {
        ...state,
        mainView: 'projects',
        automationEditorRequest: null,
        rightPanelOpen: false,
        tabStrip: showView(state, { kind: 'projects' }),
      };
    case 'CLOSE_PROJECTS':
      return state.mainView === 'projects' ? { ...state, mainView: 'session' } : state;
    case 'OPEN_AUTOMATIONS':
      return {
        ...state,
        mainView: 'automations',
        automationEditorRequest: action.automationId
          ? createAutomationEditorRequest(action.automationId)
          : null,
        rightPanelOpen: false,
        tabStrip: showView(state, { kind: 'automations' }),
      };

    case 'OPEN_TAB':
    case 'OPEN_NEW_TAB':
    case 'ACTIVATE_TAB':
    case 'CLOSE_TAB':
    case 'REOPEN_CLOSED_TAB':
    case 'REORDER_TABS':
    case 'SPLIT_TILE':
    case 'MOVE_TILE':
    case 'FOCUS_TILE':
    case 'CLOSE_TILE':
    case 'RESIZE_TILE_COLUMNS':
    case 'RESIZE_TILE_ROWS': {
      const tabStrip = reduceTabStrip(state, action);
      if (tabStrip === state.tabStrip) return state;
      // The navigation brings the live page to the place the new strip
      // focuses. It runs against the new strip so it sees which chats stay on
      // screen; the strip it computes for itself is replaced.
      const navigation = enteredPlaceNavigation(state, tabStrip);
      const composes =
        action.type === 'CLOSE_TILE' ? withComposeTileClosed(state, action.tileId) : null;
      const entered: AppState = { ...state, ...composes, tabStrip };
      const navigated = navigation ? reducer(entered, navigation) : entered;
      return withTilesSeen({ ...navigated, tabStrip }, Date.now());
    }

    // The chat leaves any other tab first, so showing it lands here instead
    // of switching to that tab. A mission or a design keeps a tab of its own.
    case 'DROP_CHAT': {
      const tabStrip = fillsTab(state, action.appSessionId)
        ? state.tabStrip
        : withoutOtherTabsShowing(state.tabStrip, action.appSessionId);
      const moved: AppState = { ...state, tabStrip };
      const target = action.tileId
        ? reducer(moved, { type: 'FOCUS_TILE', tileId: action.tileId })
        : moved;
      return reducer(target, { type: 'SET_ACTIVE_SESSION', id: action.appSessionId });
    }

    case 'CLOSE_AUTOMATIONS':
      return state.mainView !== 'automations' && !state.automationEditorRequest
        ? state
        : { ...state, mainView: 'session', automationEditorRequest: null };

    case 'AUTOMATION_EDITOR_REQUEST_HANDLED':
      return state.automationEditorRequest?.requestId === action.requestId
        ? { ...state, automationEditorRequest: null }
        : state;

    case 'START_CHAT': {
      // Design previews run in the laptop's own window, so a Remote browser
      // starts a chat wherever a design would start.
      if (action.canvas && isRemoteClient()) {
        return reducer(state, { type: 'START_CHAT', ...newDraft(state, 'chat') });
      }
      // Stamp the session being left so model output produced while it was
      // open doesn't surface as an unread badge after starting a new chat.
      const sessionLastSeen = { ...state.sessionLastSeen };
      if (state.activeAppSessionId && lookup(state.sessions, state.activeAppSessionId)) {
        sessionLastSeen[state.activeAppSessionId] = Date.now();
      }
      const next = invalidateSelectedChildOpening(state);
      const draftChat = {
        cwd: action.cwd,
        executionMode: action.executionMode,
        branch: action.branch,
        ...(action.project ? { project: action.project } : {}),
        ...(action.canvas ? { canvas: action.canvas } : {}),
      };
      return {
        ...next,
        draftChat,
        draftAutonomy: null,
        draftFastMode: false,
        draftContextWindowTokens: null,
        activeAppSessionId: null,
        missionControlMode: false,
        selectedChild: null,
        // Leaving for a fresh draft orphans any pending review-focus request.
        reviewFocusPath: null,
        reviewFocusChange: null,
        sessionLastSeen,
        mainView: 'session',
        automationEditorRequest: null,
        tabStrip: showNewChat(state, draftChat),
      };
    }

    // A seed belongs to its chat from the moment it arrives: the one named, or
    // else the chat focused now, or else the draft in the focused tab.
    case 'SEED_COMPOSER': {
      const appSessionId = action.appSessionId ?? state.activeAppSessionId;
      const draftTileId = appSessionId ? null : activeDraftTileId(state);
      if (!appSessionId && !draftTileId) return state;
      const seed = createComposerSeed(action.text, action.replace, {
        appSessionId,
        draftTileId,
        send: action.send,
        focus: action.focus,
        prompt: action.prompt,
      });
      return { ...state, composerSeeds: [...state.composerSeeds, seed] };
    }
    // The composer consumes each seed once; it must not linger, or remounting
    // the composer (e.g. toggling Mission Control) would re-apply stale text.
    case 'CONSUME_COMPOSER_SEED': {
      const seed = state.composerSeeds.find((pending) => pending.id === action.id);
      if (!seed) return state;
      const next = { ...state, composerSeeds: state.composerSeeds.filter((s) => s !== seed) };
      // A prompt sent with a chat's marks goes out as it is consumed, to that
      // chat and never to a child open in it, which would get it without them.
      return seed.send && state.selectedChild?.parentAppSessionId === seed.appSessionId
        ? reduceSelectChild(next, { selection: null })
        : next;
    }

    case 'SESSION_NOTE_ADD': {
      const sessionNotes = addSessionNote(state.sessionNotes, action.appSessionId, action.text);
      // Blank notes are rejected by the helper; nothing changed.
      if (!sessionNotes) return state;
      return { ...state, sessionNotes };
    }

    case 'SESSION_NOTE_MARK_USED': {
      const sessionNotes = markSessionNoteUsed(
        state.sessionNotes,
        action.appSessionId,
        action.noteId,
      );
      // Already marked or unknown note; nothing changed.
      if (!sessionNotes) return state;
      return { ...state, sessionNotes };
    }

    case 'SESSION_NOTE_REMOVE':
      return {
        ...state,
        sessionNotes: removeSessionNote(state.sessionNotes, action.appSessionId, action.noteId),
      };

    case 'ADD_WORKSPACE':
      return {
        ...state,
        workspaceCwds: addWorkspaceCwd(state.workspaceCwds, action.cwd),
      };
    case 'REMOVE_WORKSPACE':
      return {
        ...state,
        workspaceCwds: removeWorkspaceCwd(state.workspaceCwds, action.cwd),
      };
    case 'SET_WORKSPACE_CWDS':
      return { ...state, workspaceCwds: action.cwds };

    case 'REVEAL_EARLIER_SESSIONS': {
      const revealEarlierCwds = withRevealedCwds(state.revealEarlierCwds, action.executionCwds);
      return revealEarlierCwds === state.revealEarlierCwds
        ? state
        : { ...state, revealEarlierCwds };
    }

    case 'SET_THEME':
      return { ...state, theme: { ...state.theme, ...action.theme } };

    // The dispatching handler has already saved the list (see persistCustomThemes).
    case 'SAVE_CUSTOM_THEME':
      return { ...state, customThemes: upsertCustomTheme(state.customThemes, action.preset) };

    case 'DELETE_CUSTOM_THEME':
      return { ...state, customThemes: removeCustomTheme(state.customThemes, action.id) };

    case 'SELECT_FEATURE':
      return { ...state, selectedFeatureId: action.id };

    case 'SELECT_CHILD':
      return reduceSelectChild(state, action);

    case 'MODELS_LIST':
    case 'PROVIDER_STATUSES':
    case 'SET_DRAFT_PROVIDER':
    case 'USAGE_UPDATED':
    case 'BRIDGE_SNAPSHOT':
    case 'SKILLS_LIST':
    case 'FACTORY_DEFAULTS':
    case 'SET_HARNESS_MODEL':
    case 'SET_AGENT_MODEL':
    case 'SET_AGENT_REASONING':
    case 'SET_COMPACTION_MODEL_GLOBAL':
    case 'SET_COMPACTION_TOKEN_LIMIT_GLOBAL':
    case 'SET_COMPACTION_TOKEN_LIMIT_FOR_MODEL':
    case 'SET_DEFAULT_AUTONOMY':
    case 'SET_DRAFT_AUTONOMY':
    case 'SET_DRAFT_FAST_MODE':
    case 'SET_DRAFT_CONTEXT_WINDOW':
    case 'AUTONOMY_UPDATE_REQUESTED':
    case 'AUTONOMY_UPDATE_SETTLED':
    case 'MODEL_UPDATE_REQUESTED':
    case 'SETTINGS_UPDATES_UNANSWERED':
    case 'MODEL_UPDATE_SETTLED':
      return reduceAgentSettings(state, action);

    case 'SET_LIVE_ENTER_BEHAVIOR':
      return { ...state, liveEnterBehavior: action.behavior };

    case 'SET_DEFAULT_VOICE':
      return { ...state, defaultVoice: action.voice };

    case 'SET_NARRATION_MODE':
      return { ...state, narrationMode: action.mode };

    case 'SET_IMAGE_PASTE_QUALITY':
      return { ...state, imagePasteQuality: action.quality };

    case 'SET_SHORTCUT_BINDING':
      return {
        ...state,
        shortcutBindings: { ...state.shortcutBindings, [action.shortcut]: action.chord },
      };

    case 'SET_TOOL_ACTIVITY':
      return { ...state, toolActivity: action.settings };

    default:
      return state;
  }
}

/* ── Bridge event adapter ── */
export function toastMessageForEvent(ev: ServerEvent): string | undefined {
  if (
    ev.type === 'error' &&
    (ev.code === 'history.unavailable' || ev.code === 'history.search_unavailable')
  )
    return ev.message;
  if (isHistoryStatusError(ev)) return undefined;
  if (
    ev.type === 'error' &&
    (ev.code === 'bridge.unsupported_command' ||
      ev.code === 'bridge.resync_required' ||
      ev.code === 'history.unflushed_work' ||
      ev.code === 'session.interrupted' ||
      ev.code === 'session.autonomy_update_failed' ||
      ev.code === 'session.model_update_failed' ||
      ev.code === 'session.create_failed')
  ) {
    return ev.message;
  }
  return ev.type === 'child.error' && ev.operation !== 'open' ? ev.message : undefined;
}

// Two lists of the same voices in the same order are the same answer.
function sameVoices(current: string[], next: string[]): boolean {
  return current.length === next.length && current.every((voice, at) => voice === next[at]);
}

export function adaptEvent(ev: ServerEvent): Action | null {
  switch (ev.type) {
    case 'connection':
      return {
        type: 'SET_CONNECTION',
        status: ev.status === 'connected' ? 'connected' : 'error',
        message: ev.message,
      };
    case 'session.created':
      return { type: 'SESSION_CREATED', clientRef: ev.clientRef, session: ev.session };
    case 'session.forked':
      return { type: 'SESSION_FORKED', clientRef: ev.clientRef, session: ev.session };
    case 'session.updated':
      return { type: 'SESSION_UPDATED', session: ev.session };
    case 'session.autonomy_update_applied':
      return {
        type: 'AUTONOMY_UPDATE_SETTLED',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'session.model_update_applied':
      return {
        type: 'MODEL_UPDATE_SETTLED',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'session.closed':
      return { type: 'SESSION_CLOSED', appSessionId: ev.appSessionId };
    case 'session.processes':
      return { type: 'SESSION_PROCESSES', appSessionId: ev.appSessionId, processes: ev.processes };
    case 'projects.snapshot':
      return { type: 'PROJECTS_SNAPSHOT', projects: ev.projects };
    case 'sessions.processes':
      return { type: 'SESSIONS_PROCESSES', processes: ev.processes };
    case 'mission.features':
      return { type: 'SESSION_FEATURES', appSessionId: ev.appSessionId, features: ev.features };
    case 'mission.progress':
      return { type: 'SESSION_PROGRESS', appSessionId: ev.appSessionId, entries: ev.entries };
    case 'session.child':
      return {
        type: 'SESSION_CHILD',
        child: ev.child,
        runtimeAvailable: ev.runtimeAvailable,
        runtimeGeneration: ev.runtimeGeneration,
      };
    case 'child.updated':
      return ev.access === 'ready'
        ? {
            type: 'CHILD_UPDATED',
            parentAppSessionId: ev.parentAppSessionId,
            childSessionId: ev.childSessionId,
            requestId: ev.requestId,
            access: 'ready',
            runtimeGeneration: ev.runtimeGeneration,
          }
        : {
            type: 'CHILD_UPDATED',
            parentAppSessionId: ev.parentAppSessionId,
            childSessionId: ev.childSessionId,
            requestId: ev.requestId,
            access: 'history',
          };
    case 'child.error':
      return {
        type: 'CHILD_ERROR',
        parentAppSessionId: ev.parentAppSessionId,
        childSessionId: ev.childSessionId,
        requestId: ev.requestId,
        operation: ev.operation,
        message: ev.message,
      };
    case 'event.appended':
      return { type: 'SESSION_TRANSCRIPT', event: ev.event };
    case 'approval.requested':
      return { type: 'SESSION_PERMISSION', request: ev.request };
    case 'question.requested':
      return { type: 'SESSION_QUESTION', question: ev.question };
    case 'interaction.cancelled':
    case 'question.answered':
      return {
        type: 'CLEAR_INTERACTION',
        appSessionId: ev.appSessionId,
        requestId: ev.requestId,
      };
    case 'error':
      if (isHistoryStatusError(ev)) return null;
      if (ev.code === 'bridge.resync_required' && !ev.recoverable) {
        return { type: 'SET_CONNECTION', status: 'error', message: ev.message };
      }
      if (ev.code === 'session.autonomy_update_failed') {
        return ev.appSessionId && ev.requestId
          ? {
              type: 'AUTONOMY_UPDATE_SETTLED',
              appSessionId: ev.appSessionId,
              requestId: ev.requestId,
            }
          : null;
      }
      if (ev.code === 'session.model_update_failed') {
        return ev.appSessionId && ev.requestId
          ? { type: 'MODEL_UPDATE_SETTLED', appSessionId: ev.appSessionId, requestId: ev.requestId }
          : null;
      }
      // The chat list waits to hear about projects before it paints, so a
      // runtime that cannot answer has to count as having answered.
      if (ev.code?.startsWith('project.'))
        return { type: 'PROJECTS_UNAVAILABLE', message: ev.message };
      if (ev.code === 'session.create_failed' && ev.clientRef) {
        return {
          type: 'SESSION_CREATE_FAILED',
          clientRef: ev.clientRef,
          message: ev.message,
        };
      }
      if (ev.recoverable) return null;
      if (ev.appSessionId) {
        return {
          type: 'SESSION_ERROR',
          appSessionId: ev.appSessionId,
          providerSessionId: ev.providerSessionId,
          message: ev.message,
        };
      }
      return { type: 'SESSION_ERROR', message: ev.message };
    case 'sessions.list':
      return {
        type: 'SESSION_LIST',
        sessions: ev.sessions,
        earlierSessionsByCwd: ev.earlierSessionsByCwd,
      };
    case 'session.history':
      return {
        type: 'SESSION_HISTORY',
        appSessionId: ev.appSessionId,
        childSessionId: ev.childSessionId,
        progress: ev.progress,
        transcripts: ev.transcripts,
        childSessions: ev.childSessions,
        mode: ev.mode,
        olderCursor: ev.olderCursor,
        loadedCount: ev.loadedCount,
        hasMore: ev.hasMore,
      };
    case 'session.history.error':
      return {
        type: 'SESSION_HISTORY_FAILED',
        appSessionId: ev.appSessionId,
        childSessionId: ev.childSessionId,
        message: ev.message,
      };
    case 'context.updated':
      return {
        type: 'CONTEXT_UPDATED',
        appSessionId: ev.appSessionId,
        sourceSessionId: ev.sourceSessionId,
        ...(ev.parentAppSessionId === undefined
          ? {}
          : { parentAppSessionId: ev.parentAppSessionId }),
        ...(ev.childSessionId === undefined ? {} : { childSessionId: ev.childSessionId }),
        stats: ev.stats,
      };
    case 'catalog.updated':
      if (ev.catalog === 'models') {
        return { type: 'MODELS_LIST', models: ev.items as ModelInfo[] };
      }
      if (ev.catalog === 'skills') {
        const skills = (ev.items as SkillInfo[]).filter(
          (s) => s && typeof s.name === 'string' && s.name.length > 0,
        );
        return {
          type: 'SKILLS_LIST',
          skills,
          providerSessionId: ev.providerSessionId ?? null,
        };
      }
      return null;
    case 'provider.status':
      return { type: 'PROVIDER_STATUSES', statuses: ev.statuses };
    case 'usage.updated':
      return { type: 'USAGE_UPDATED', usage: ev.usage };
    case 'settings.defaults':
      return { type: 'FACTORY_DEFAULTS', defaults: ev.defaults };
    case 'browser.updated':
      return { type: 'BROWSER_UPDATED', browser: ev.state };
    case 'browser.closed':
      return { type: 'BROWSER_CLOSED', appSessionId: ev.appSessionId, keepPane: ev.keepPane };
    case 'browser.error':
      return { type: 'BROWSER_ERROR', appSessionId: ev.appSessionId, message: ev.message };
    case 'voice.answer':
      return {
        type: 'VOICE_ANSWERED',
        appSessionId: ev.appSessionId,
        sdp: ev.sdp,
        attempt: ev.attempt,
      };
    case 'voice.state':
      return { type: 'VOICE_STATE', appSessionId: ev.appSessionId, status: ev.status };
    case 'voice.transcript':
      return {
        type: 'VOICE_TRANSCRIPT',
        appSessionId: ev.appSessionId,
        role: ev.role,
        text: ev.text,
        final: ev.final,
      };
    case 'voice.voices':
      return {
        type: 'VOICE_VOICES',
        appSessionId: ev.appSessionId,
        voices: ev.voices,
        defaultVoice: ev.defaultVoice,
      };
    case 'voice.error':
      return { type: 'VOICE_ERROR', appSessionId: ev.appSessionId, message: ev.message };
    default:
      return null;
  }
}

interface StoreContextValue {
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, reduceDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const listenersRef = useRef(new Set<() => void>());
  const bridgeActionBatcherRef = useRef<OrderedActionBatcher<Action> | null>(null);
  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    // A bridge event received before this local action must reduce first even
    // when it is waiting in the current frame's follower batch.
    const batcher = bridgeActionBatcherRef.current;
    if (batcher) batcher.dispatchLocal(action);
    else reduceDispatch(action);
  }, []);
  const [store] = useState<StoreContextValue>(() => ({
    getState: () => stateRef.current,
    subscribe: (listener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    dispatch,
  }));

  useLayoutEffect(() => {
    stateRef.current = state;
    // Closes the perf receive→commit leg for events reduced by this commit.
    noteStoreCommitted();
    for (const listener of listenersRef.current) listener();
  }, [state]);

  const persistedStateRef = useRef(state);
  useEffect(() => {
    persistStoreChanges(persistedStateRef.current, state);
    persistedStateRef.current = state;
  }, [state]);

  // Keep the sidecar's compaction-limit snapshot in sync so live sessions,
  // resumes, and model changes all follow these limits. The bridge queues
  // commands until the socket opens, so the mount-time push is safe. Keyed on
  // the settings revision rather than the values: a clear can leave the values
  // structurally identical (undefined -> undefined) while the user-configured
  // markers changed, and that must still reach the sidecar.
  useEffect(() => {
    updateCompactionSettings(compactionSettingsSnapshot(state));
  }, [state.compactionSettingsRev]);

  // Persist the reload snapshot only when the session list or the active
  // transcript actually changed (references are immutable), debounced so
  // streaming bursts coalesce into one write. The scheduler owns its timer,
  // so an unrelated state change can never cancel a pending write, and the
  // effect depends on the derived active transcript so background sessions'
  // transcript updates do not retrigger it.
  const [snapshotScheduler] = useState(() => createSnapshotScheduler(400));
  const activeTranscriptEvents = state.activeAppSessionId
    ? state.transcripts[state.activeAppSessionId]
    : undefined;
  useEffect(() => {
    const activeId = state.activeAppSessionId;
    snapshotScheduler.push({
      sessions: state.sessions,
      sessionOrder: state.sessionOrder,
      listConfirmedSessionIds: state.listConfirmedSessionIds,
      activeTranscript:
        activeId !== null && activeTranscriptEvents !== undefined
          ? { appSessionId: activeId, events: activeTranscriptEvents }
          : undefined,
    });
  }, [
    snapshotScheduler,
    state.sessions,
    state.sessionOrder,
    state.listConfirmedSessionIds,
    state.activeAppSessionId,
    activeTranscriptEvents,
  ]);
  useEffect(
    () => () => {
      snapshotScheduler.cancel();
    },
    [snapshotScheduler],
  );

  useEffect(() => {
    // Concurrent streams can deliver many bridge events per frame (token
    // deltas, usage and context telemetry, child updates), and every dispatch
    // still notifies each selective subscriber. Batch per frame with a leading
    // edge: the first event after an idle gap dispatches immediately
    // (interactive round-trips stay instant), followers arriving within the
    // same 16ms window flush together as one ordered state transition.
    const batcher = createOrderedActionBatcher<Action, number>({
      dispatchOne: reduceDispatch,
      dispatchBatch: (actions) => {
        reduceDispatch({ type: 'BATCH', actions });
      },
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => {
        window.clearTimeout(timer);
      },
      delayMs: 16,
    });
    bridgeActionBatcherRef.current = batcher;
    const unsub = bridge.subscribeBatch((events, fromSnapshot) => {
      const actions: Action[] = fromSnapshot ? [{ type: 'BRIDGE_SNAPSHOT' }] : [];
      for (const ev of events) {
        // Verbose per-event logging runs on every streaming token and eagerly
        // deep-clones + redacts the whole event, so keep it to dev builds only;
        // production strips this branch entirely.
        if (import.meta.env.DEV) console.log('[bridge]', ev.type, sanitizeForLog(ev));
        applyHistoryServerEvent(ev);
        const toastMessage = toastMessageForEvent(ev);
        if (toastMessage !== undefined) toast.error(toastMessage);
        const action = adaptEvent(ev);
        if (!action) {
          // No reducer work means no commit: drop the perf leg instead of
          // closing it against the next unrelated commit.
          discardPendingBridgeEvent(ev);
          continue;
        }
        actions.push(action);
      }
      batcher.pushBridgeBatch(actions);
    });
    // Queued ahead of the snapshot's own events, through the same batcher.
    const unsubReplaced = bridge.subscribeRuntimeReplaced((liveAppSessionIds, resentRequestIds) => {
      batcher.pushBridgeBatch([
        { type: 'SETTINGS_UPDATES_UNANSWERED', liveAppSessionIds, resentRequestIds },
      ]);
    });
    return () => {
      unsub();
      unsubReplaced();
      // StrictMode remounts this effect in dev; deliver anything in flight so
      // no event is lost across the resubscribe.
      batcher.dispose();
      if (bridgeActionBatcherRef.current === batcher) bridgeActionBatcherRef.current = null;
    };
  }, []);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function StaticStoreProvider({
  state,
  dispatch,
  children,
}: {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  children: ReactNode;
}) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const [store] = useState<StoreContextValue>(() => ({
    getState: () => stateRef.current,
    subscribe: () => () => undefined,
    dispatch,
  }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function useStoreContext(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}

export function useStoreApi(): Pick<StoreContextValue, 'getState' | 'subscribe'> {
  return useStoreContext();
}

export function useStoreDispatch(): React.Dispatch<Action> {
  return useStoreContext().dispatch;
}

export function useStoreSelector<Selected>(
  selector: (state: AppState) => Selected,
  isEqual: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const store = useStoreContext();
  const committedSelectionRef = useRef<{ hasValue: false } | { hasValue: true; value: Selected }>({
    hasValue: false,
  });
  const getSelection = useMemo(() => {
    let hasMemo = false;
    let memoizedState: AppState;
    let memoizedSelection: Selected;
    return () => {
      const nextState = store.getState();
      if (!hasMemo) {
        hasMemo = true;
        memoizedState = nextState;
        const nextSelection = selector(nextState);
        const committed = committedSelectionRef.current;
        if (committed.hasValue && isEqual(committed.value, nextSelection)) {
          memoizedSelection = committed.value;
          return committed.value;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }
      if (Object.is(memoizedState, nextState)) return memoizedSelection;
      const nextSelection = selector(nextState);
      memoizedState = nextState;
      if (isEqual(memoizedSelection, nextSelection)) return memoizedSelection;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
  }, [isEqual, selector, store]);
  const selection = useSyncExternalStore(store.subscribe, getSelection, getSelection);
  useEffect(() => {
    committedSelectionRef.current = { hasValue: true, value: selection };
  }, [selection]);
  return selection;
}

export function shallowEqual<T extends Record<string, unknown>>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}
