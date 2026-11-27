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
import { updateCompactionSettings } from '../lib/commands';
import { reducePrInbox, type PrInboxAction } from '../features/pull-requests/lib/prInboxState';
import {
  activeDraftTileId,
  composeOrigin,
  draftTileIds,
  enteredPlaceNavigation,
  showView,
  withComposeTileClosed,
  type ComposeOrigin,
} from '../features/tabs/tabNavigation';
import { activeTabDraft, loadTabStrip } from '../features/tabs/tabStorage';
import {
  activeProduct,
  fillsTab,
  isChatInView,
  newDraft,
  reduceTabStrip,
  withoutChats,
  withoutOtherTabsShowing,
  type ProductMode,
  type TabAction,
  type TabStrip,
} from '../features/tabs/tabStrip';
import { reduceVoice, type VoiceAction, type VoiceSessions } from '../features/voice/voiceSessions';
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
import type { DesignModes } from './designModeState';
import type {
  ProjectView,
  AgentProcess,
  Autonomy,
  ContextWindowTokens,
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
} from '@droidex/protocol';
import { addWorkspaceCwd, removeWorkspaceCwd, withRevealedCwds } from '../lib/workspaces';
import type { QueuedPrompt } from '../lib/promptQueue';
import { createOrderedActionBatcher, type OrderedActionBatcher } from './orderedActionBatcher';
import { applyHistoryServerEvent } from '../lib/historyHealth';
import { adaptEvent, toastMessageForEvent } from './storeEvents';
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
import { removeSessionPanel, type UtilityPanelState } from '../lib/utilityPanel';
import { settleSideChatStart, type SideChatPanel } from '../lib/sideChats';
import type { FileChange } from '../lib/diff';
import type { ImagePasteQuality } from '../lib/images';
import { estimateTranscriptCost, VIEWPORT_TRANSCRIPT_POLICY } from '../lib/transcriptWindow';
import {
  appendTranscriptEvent,
  applyMemoryPressureRelease,
  releaseSessionTranscriptWindow,
} from '../lib/transcriptStoreMemory';
import { type TranscriptMutation } from '../lib/transcriptMutation';
import { reduceSessions } from './storeSessions';
import { closeLiveChat, withTilesSeen } from './storeSessionNavigation';
import { withoutKey } from '../lib/records';
import { reduceSessionChildren } from './storeSessionChildren';
import { reduceStoreActionBatch } from './storeActionBatch';
import { reduceAgentSettings, type AgentSettingsAction } from './storeAgentSettings';
import {
  reduceSessionInteractions,
  type SessionInteractionsAction,
} from './storeSessionInteractions';
import { reduceSideChats, type SideChatAction } from './storeSideChats';
import { reduceQueue, type QueueAction } from './storeQueue';
import { reduceUtilityPanels, type UtilityPanelsAction } from './storeUtilityPanels';
import { persistStoreChanges } from './storePersistence';
import {
  invalidateSelectedChildOpening,
  reduceChildSession,
  releaseInactiveChildTranscript,
  type ChildAccess,
  type ChildHistoryState,
  type ChildRuntimeState,
  type ChildSelection,
  type ChildSessionAction,
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
  | SideChatAction
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
  | ChildSessionAction
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
  | QueueAction
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
  const sessionsById: Partial<AppState['sessions']> = state.sessions;
  switch (action.type) {
    case 'SESSION_CREATED':
    case 'SESSION_FORKED':
    case 'SESSION_UPDATED':
    case 'SESSION_CLOSED':
    case 'SESSION_LIST':
    case 'SET_ACTIVE_SESSION':
    case 'START_CHAT':
      return reduceSessions(state, action, reducer);

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

    case 'FORK_REQUESTED':
      return {
        ...state,
        pendingForks: {
          ...state.pendingForks,
          [action.clientRef]: action.fork,
        },
      };

    case 'SHOW_SIDE_CHAT':
    case 'PLACE_SIDE_CHATS':
    case 'CLOSE_SIDE_CHAT':
    case 'SET_SIDE_CHAT_DEFAULT_PLACEMENT':
    case 'CHOOSE_SIDE_CHAT_HARNESS':
    case 'ATTACH_SIDE_CHAT_REPLY':
    case 'DETACH_SIDE_CHAT_REPLIES':
      return reduceSideChats(state, action);

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
      const existing = sessionsById[mid];
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
    case 'CHILD_ERROR':
    case 'CHILD_HISTORY_LOADING':
    case 'CHILD_HISTORY_LOADING_OLDER':
    case 'CHILD_TRANSCRIPT_VIEWPORT':
    case 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT':
    case 'SELECT_CHILD':
      return reduceChildSession(state, action);

    case 'CONTEXT_UPDATED': {
      const existing = sessionsById[action.appSessionId];
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
      const session = sessionsById[action.appSessionId];
      if (!session || sessionIsLive(session)) return state;
      return releaseSessionTranscriptWindow(state, action.appSessionId, VIEWPORT_TRANSCRIPT_POLICY);
    }

    case 'MEMORY_PRESSURE':
      return applyMemoryPressureRelease(state);

    case 'QUEUE_PROMPT':
    case 'REMOVE_QUEUED_PROMPT':
    case 'REORDER_QUEUE':
      return reduceQueue(state, action);

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
      const session = sessionsById[action.appSessionId];
      if (!session) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.appSessionId]: { ...session, phase: 'failed' },
        },
      };
    }

    case 'SESSION_HISTORY_LOADING_OLDER':
      return reduceSessionHistoryLoadingOlder(state, action);

    case 'SESSION_RESTORE_START':
      return reduceSessionRestoreStart(state, action);

    case 'SESSION_HISTORY_FAILED':
      return reduceSessionHistoryFailed(state, action);

    case 'SESSION_HISTORY':
      return reduceSessionHistory(state, action);

    case 'MARK_ALL_SESSIONS_READ': {
      const sessionLastSeen = { ...state.sessionLastSeen };
      let changed = false;
      for (const appSessionId of state.sessionOrder) {
        const session = sessionsById[appSessionId];
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

    case 'VOICE_CONNECTING':
    case 'VOICE_ANSWERED':
    case 'VOICE_STATE':
    case 'VOICE_ERROR':
    case 'VOICE_ENDED':
    case 'VOICE_VOICES':
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
        ? reduceChildSession(next, { type: 'SELECT_CHILD', selection: null })
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

    default: {
      const unhandled: never = action;
      void unhandled;
      return state;
    }
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

// Shallow equal with one key compared by a custom rule: selector baskets that
// carry a session object compare it telemetry-blind while every other key
// stays reference-equal.
export function shallowEqualExcept<T extends Record<string, unknown>, K extends keyof T>(
  key: K,
  equalKey: (left: T[K], right: T[K]) => boolean,
): (left: T, right: T) => boolean {
  return (left, right) => {
    if (Object.is(left, right)) return true;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    if (!equalKey(left[key], right[key])) return false;
    return leftKeys.every((name) => name === String(key) || Object.is(left[name], right[name]));
  };
}
