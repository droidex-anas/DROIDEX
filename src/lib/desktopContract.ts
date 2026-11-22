import type { PublishedProfile } from '../../packages/remote/src/profile';
import type { RemoteState, RemoteSettings, RemoteSetup } from '../../packages/remote/src/desktop';
import type { ProfileUsageSnapshot } from '../features/profile/profileShare';
import type {
  NativeBrowserDesignEvent,
  NativeBrowserDesignState,
  NativeBrowserKeyPress,
  NativeBrowserLoadFailed,
  NativeBrowserLoaded,
  NativeBrowserAgentPoint,
  NativeBrowserAgentPress,
  NativeBrowserFrame,
  NativeBrowserWorking,
} from './nativeBrowser';
import type { NativeBrowserChord } from './shortcuts';
import type {
  BrowserViewportMode,
  CanvasErrorCode,
  DesignSystemVersionRef,
  OwnedAsset,
  RevisionRef,
} from '@droidex/protocol';
import type { EditorId, EditorTarget } from './editorOpen';
import type { RepoStatus } from './repoEnvironment';
import type {
  AppUpdateCheckOptions,
  AppUpdateInfo,
  AppUpdateResult,
  OnboardingState,
} from './onboarding';
import type { AppIconMode } from './appIcon';
import type { UsageAnalyticsBootstrap } from './usageAnalytics';
import type {
  CommitOptions,
  CreateBranchOptions,
  CreatePrOptions,
  CreatePrResult,
  CreateWorktreeOptions,
  DetectPrResult,
  DiffFileList,
  DiffScope,
  DiffStatMode,
  FileDiffResult,
  GitActionResult,
  GitBranchList,
  GitDiffStat,
  GitEnvironment,
  GitWorktree,
  GithubAvailability,
  GithubSetupResult,
  PostCommentResult,
  PrChecksResult,
  PrCommentsResult,
  PrMergeMethod,
  PrMergeResult,
  PullRequestDiffResult,
  PullRequestListResult,
  PullRequestViewResult,
  PushOptions,
} from '../types/vcs';

export interface BridgeInfo {
  port: number;
  token: string;
}

export type SidecarLifecycle =
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'restarting'
  | 'recovery-required'
  | 'stopped';

export interface SidecarSupervisorSnapshot {
  lifecycle: SidecarLifecycle;
  processAlive: boolean;
  bridgeResponsive: boolean;
  lastHeartbeatAt: number | null;
  restartCount: number;
  reason?: string;
  port?: number;
}

export interface CanvasPreviewCaptureRequest {
  requestId: string;
  guestId: number;
  /** Null for a kit-bound guest, whose capture main returns but does not keep. */
  canvasId: string | null;
  designId: string;
  revisionId: string;
  generation: number;
  width: number;
  height: number;
  scaleFactor: number;
  /** Main keeps the capture for one `canvasImageSave` of this request ID. */
  retain: boolean;
}

export type CanvasPreviewCaptureResult =
  | { ok: true; mediaType: 'image/png'; bytes: Uint8Array }
  | { ok: false; error: { code: 'capture_unavailable'; message: string } };

/** Both host exports answer this way, so a refusal reaches the renderer as its own message. */
export type CanvasExportResult =
  | { ok: true; filesWritten: number }
  | { ok: false; cancelled: true }
  | { ok: false; code: CanvasErrorCode; message: string };

/** A folder inside a chat's project, named relative to the project folder. */
export interface ProjectExportTarget {
  appSessionId: string;
  folder: string;
}

export type CanvasImageSaveResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; code: 'capture_unavailable' | 'storage_failed'; message: string };

export interface TerminalSessionInfo {
  id: string;
  appSessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited?: boolean;
  exitCode?: number | null;
}

export type TerminalEvent =
  | {
      kind: 'replay';
      data: string;
      sequence: number;
      truncated: boolean;
      droppedBytes: number;
      byteOffset: number;
      totalEmittedBytes: number;
    }
  | {
      kind: 'data';
      data: string;
      sequence: number;
      byteOffset: number;
      truncated?: boolean;
      droppedBytes?: number;
      totalEmittedBytes?: number;
    }
  | {
      kind: 'exit';
      sequence: number;
      exitCode: number | null;
      signal: number | null;
    }
  | {
      kind: 'error';
      message: string;
    };

export interface TerminalDataChannel {
  postInput: (data: string) => void;
  onEvent: (handler: (event: TerminalEvent) => void) => () => void;
  close: () => void;
}

// Stored values every copy of the app shares; the desktop app accepts no others.
export type SharedStorageKey = 'droid-workspaces' | 'droid-chat-metadata';

export interface SharedStorageChange {
  key: SharedStorageKey;
  value: string;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: string[];
}

export interface FilesEntry {
  name: string;
  kind: 'directory' | 'file';
}

export interface FilesListing {
  root: string;
  relative: string;
  entries: FilesEntry[];
  totalSeen: number;
  capped: boolean;
  permissionDenied: boolean;
}

export interface FilePreviewPayload {
  category: 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'external';
  totalSize: number;
  mtimeMs: number;
  sizeCapBytes: number;
  previewable: boolean;
  oversize?: boolean;
  reason?: string;
  encoding?: 'utf8' | 'binary';
  text?: string;
  data?: Uint8Array;
  path: { root: string; relative: string };
}

export type FeedbackCategory = 'bug' | 'bad_result' | 'good_result' | 'safety' | 'other';

export interface FeedbackAttachments {
  sessionLog?: boolean;
  screenshot?: boolean;
  appState?: boolean;
}

export interface FeedbackReportRequest {
  category: FeedbackCategory;
  description: string;
  attachments?: FeedbackAttachments;
  attachmentData?: {
    sessionLog?: { category: string; message: string; level?: string; timestamp: number }[];
    appState?: Record<string, unknown>;
  };
}

export interface FeedbackReportReceipt {
  reportId: string;
  userId: string;
  eventId: string;
}

export interface NotifyOptions {
  /** When true, the OS notification plays without sound. */
  silent?: boolean;
  /** Session to open when the user clicks the notification. */
  appSessionId?: string;
}

export type NotifyResult =
  | { shown: true }
  | {
      shown: false;
      reason: 'unsupported' | 'permission_denied' | 'failed' | 'timeout';
      message?: string;
    };

export type SaveImageResult = { saved: true; filePath: string } | { saved: false };

export type RemoteNotificationState =
  | 'on'
  | 'off'
  | 'unsupported'
  | 'needs-home-screen'
  | 'not-remembered';

/** A Remote browser's own pairing with the laptop. */
export interface RemoteBrowserControls {
  handle: string;
  trustedUntil: () => number;
  notifications: () => Promise<RemoteNotificationState>;
  setNotifications: (enabled: boolean) => Promise<RemoteNotificationState>;
  forget: () => Promise<void>;
}

/** The part of a WebSocket the bridge uses; a Remote browser tunnels it to the laptop. */
export interface BridgeSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface DroidexApi {
  /** Set by DROIDEX Remote: this window is a browser driving the laptop over the relay. */
  remoteBrowser?: RemoteBrowserControls;
  openBridgeSocket?: (url: string) => BridgeSocket;
  getRemoteState: () => Promise<RemoteState>;
  configureRemote: (patch: Partial<RemoteSettings>) => Promise<RemoteState>;
  setupRemoteAuthenticator: () => Promise<RemoteSetup>;
  confirmRemoteAuthenticator: (code: string) => Promise<RemoteState>;
  decideRemoteRequest: (id: string, approved: boolean) => Promise<RemoteState>;
  revokeRemoteDevice: (id: string) => Promise<RemoteState>;
  resetRemotePairing: () => Promise<RemoteState>;
  getPublishedProfile: () => Promise<PublishedProfile | null>;
  publishPublicProfile: (payload: string) => Promise<PublishedProfile>;
  revokePublicProfile: (payload: string) => Promise<void>;
  remoteQr: (text: string) => Promise<string>;
  onRemoteState: (handler: (state: RemoteState) => void) => () => void;
  getProfileUsage: () => Promise<ProfileUsageSnapshot>;
  bridgeInfo: () => Promise<BridgeInfo>;
  sidecarStatus: () => Promise<SidecarSupervisorSnapshot>;
  onSidecarStatus: (handler: (status: SidecarSupervisorSnapshot) => void) => () => void;
  pickDirectory: () => Promise<string | null>;
  pickFiles: () => Promise<string[]>;
  canvasPickImage: (canvasId: string) => Promise<OwnedAsset | null>;
  canvasDropImage: (canvasId: string, file: File) => Promise<OwnedAsset>;
  canvasPasteSvg: (canvasId: string, svg: string) => Promise<OwnedAsset>;
  canvasPickKitImage: () => Promise<OwnedAsset | null>;
  canvasDropKitImage: (file: File) => Promise<OwnedAsset>;
  /** A kit image's bytes, or null when the store does not hold that image intact. */
  canvasReadKitImage: (
    assetId: string,
  ) => Promise<{ mime: OwnedAsset['mediaType']; data: Uint8Array } | null>;
  listDirectories: (path: string) => Promise<DirectoryListing>;
  saveImage: (dataUrl: string) => Promise<string>;
  saveAttachment: (name: string, dataUrl: string) => Promise<string>;
  discardImage: (path: string) => Promise<void>;
  saveImageAs: (url: string, name: string) => Promise<SaveImageResult>;
  pathForFile: (file: File) => string;
  notify: (title: string, body: string, options?: NotifyOptions) => Promise<NotifyResult>;
  onNotificationActivate: (handler: (payload: { appSessionId: string }) => void) => () => void;
  takePendingNotificationSession: () => Promise<{ appSessionId: string } | null>;
  ackNotificationActivate: (appSessionId: string) => Promise<{ ok: boolean }>;
  getApiKey: () => Promise<string | null>;
  setApiKey: (key: string) => Promise<void>;
  listFiles: (dir: string) => Promise<string[]>;
  getPerformanceMetrics: () => Promise<DesktopPerformanceMetrics>;
  /** Null where previews cannot run, such as a Remote browser. */
  canvasPreviewUrl: string | null;
  canvasPreviewBind: (guestId: number, binding: PreviewGuestBinding) => Promise<boolean>;
  canvasPreviewTerminate: (guestId: number) => Promise<boolean>;
  canvasPreviewCapture: (
    request: CanvasPreviewCaptureRequest,
  ) => Promise<CanvasPreviewCaptureResult>;
  canvasPreviewCancelCapture: (requestId: string) => Promise<boolean>;
  canvasThumbnailRead: (
    canvasId: string,
    designId: string,
    revisionId: string,
  ) => Promise<Uint8Array | null>;
  canvasImageSave: (requestId: string, suggestedName: string) => Promise<CanvasImageSaveResult>;
  canvasSvgSave: (svg: string, suggestedName: string) => Promise<CanvasImageSaveResult>;
  canvasExportSource: (
    canvasId: string,
    ref: RevisionRef,
    project?: ProjectExportTarget & { requestId: string },
  ) => Promise<CanvasExportResult>;
  canvasExportSourceCancel: (requestId: string) => Promise<void>;
  canvasExportDesignSystem: (ref: DesignSystemVersionRef) => Promise<CanvasExportResult>;
  systemIdleTime: () => Promise<number>;
  powerTier: () => Promise<DesktopPowerTierSnapshot>;
  onPowerTier: (handler: (snapshot: DesktopPowerTierSnapshot) => void) => () => void;
  onMemoryPressure: (handler: (payload: { at: number }) => void) => () => void;
  readFile: (path: string) => Promise<string>;
  /** The bytes behind a droidex-img URL, for a Remote browser that cannot load the scheme. */
  readLocalImage: (url: string) => Promise<{ mime: string; data: Uint8Array }>;
  /** The laptop window's stored values for these keys, so a Remote browser starts from its projects and look. */
  readRendererStorage: (keys: string[]) => Promise<Record<string, string | null>>;
  /** Relays a saved shared value to the laptop window and every paired Remote browser but this one. */
  writeSharedStorage: (key: SharedStorageKey, value: string) => Promise<void>;
  onSharedStorage: (handler: (change: SharedStorageChange) => void) => () => void;
  repoStatus: (dir: string) => Promise<RepoStatus | null>;
  listEditors: () => Promise<EditorId[]>;
  editorIcon: (editor: EditorId) => Promise<string | null>;
  openProject: (dir: string, editor: EditorId, target: EditorTarget) => Promise<void>;
  gitEnvironment: (dir: string) => Promise<GitEnvironment>;
  gitBranches: (dir: string) => Promise<GitBranchList>;
  gitWorktrees: (dir: string) => Promise<GitWorktree[]>;
  gitDiffStat: (dir: string, options: { mode: DiffStatMode }) => Promise<GitDiffStat>;
  gitDiffFiles: (
    dir: string,
    options: { mode: DiffScope; appSessionId?: string },
  ) => Promise<DiffFileList>;
  gitFileDiff: (
    dir: string,
    options: { mode: DiffScope; path: string; ignoreWhitespace?: boolean; appSessionId?: string },
  ) => Promise<FileDiffResult>;
  gitMarkTurnStart: (
    dir: string,
    appSessionId?: string,
  ) => Promise<{ ok: boolean; baseline?: string | null }>;
  gitCreateBranch: (dir: string, options: CreateBranchOptions) => Promise<GitActionResult>;
  gitCheckout: (
    dir: string,
    options: { ref: string; allowDirty?: boolean },
  ) => Promise<GitActionResult>;
  gitCreateWorktree: (dir: string, options: CreateWorktreeOptions) => Promise<GitActionResult>;
  gitRemoveWorktree: (
    dir: string,
    options: { path: string; force?: boolean },
  ) => Promise<GitActionResult>;
  gitCommit: (dir: string, options: CommitOptions) => Promise<GitActionResult>;
  gitPush: (dir: string, options: PushOptions) => Promise<GitActionResult>;
  gitFetch: (dir: string) => Promise<GitActionResult>;
  githubAvailable: () => Promise<GithubAvailability>;
  githubInstall: () => Promise<GithubSetupResult>;
  githubAuthenticate: () => Promise<GithubSetupResult>;
  githubCancelSetup: () => Promise<{ ok: true }>;
  onGithubAuthCode: (handler: (payload: unknown) => void) => () => void;
  githubDetectPr: (dir: string, options: { branch?: string }) => Promise<DetectPrResult>;
  githubListPrs: (
    dir: string,
    options?: { state?: string; limit?: number },
  ) => Promise<PullRequestListResult>;
  githubViewPr: (dir: string, options: { prNumber: number }) => Promise<PullRequestViewResult>;
  githubPrDiff: (dir: string, options: { prNumber: number }) => Promise<PullRequestDiffResult>;
  githubPrChecks: (dir: string, options: { prNumber: number }) => Promise<PrChecksResult>;
  githubPrComments: (dir: string, options: { prNumber: number }) => Promise<PrCommentsResult>;
  githubCreatePr: (dir: string, options: CreatePrOptions) => Promise<CreatePrResult>;
  githubPostComment: (
    dir: string,
    options: { prNumber: number; body: string },
  ) => Promise<PostCommentResult>;
  githubMergePr: (
    dir: string,
    options: { prNumber: number; method: PrMergeMethod },
  ) => Promise<PrMergeResult>;
  getOnboarding: () => Promise<OnboardingState>;
  setOnboarding: (patch: Partial<OnboardingState>) => Promise<OnboardingState>;
  appVersion: () => Promise<string>;
  checkAppUpdate: (options: AppUpdateCheckOptions) => Promise<AppUpdateInfo>;
  downloadAppUpdate: () => Promise<AppUpdateResult>;
  submitFeedbackReport: (report: FeedbackReportRequest) => Promise<FeedbackReportReceipt>;
  usageAnalyticsBootstrap: () => Promise<UsageAnalyticsBootstrap>;
  usageAnalyticsFirstLaunchReported: () => Promise<{ recorded: boolean }>;
  getUsageAnalytics: () => Promise<{ enabled: boolean }>;
  setUsageAnalytics: (enabled: boolean) => Promise<{ enabled: boolean }>;
  getHardwareAcceleration: () => Promise<{ enabled: boolean }>;
  setHardwareAcceleration: (enabled: boolean) => Promise<{ enabled: boolean }>;
  relaunchApp: () => Promise<void>;
  setAppIcon: (mode: AppIconMode) => Promise<AppIconMode>;
  openExternal: (url: string) => Promise<void>;
  terminalCreate: (options: {
    appSessionId: string;
    cwd: string;
    cols: number;
    rows: number;
  }) => Promise<TerminalSessionInfo>;
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>;
  terminalKill: (id: string) => Promise<void>;
  terminalHasChildren: (id: string) => Promise<boolean>;
  terminalList: (appSessionId: string) => Promise<TerminalSessionInfo[]>;
  terminalSubscribe: (id: string) => TerminalDataChannel;
  terminalUnsubscribe: (id: string) => Promise<void>;
  filesAuthorizeRoot: (root: string) => Promise<string>;
  filesList: (accessToken: string, relative: string) => Promise<FilesListing>;
  filesPreview: (accessToken: string, relative: string) => Promise<FilePreviewPayload>;
  filesOpen: (accessToken: string, relative: string) => Promise<void>;
  filesReveal: (accessToken: string, relative: string) => Promise<void>;
  nativeBrowserReserve: (
    browserSessionId: string,
    savedUrl?: string,
    savedMode?: BrowserViewportMode,
  ) => Promise<{ src: string; generation: number }>;
  nativeBrowserRelease: (browserSessionId: string) => Promise<void>;
  nativeBrowserWorkingSessions: () => Promise<string[]>;
  nativeBrowserShown: (browserSessionId: string, shown: boolean) => Promise<void>;
  nativeBrowserWatch: (browserSessionId: string, watching: boolean) => Promise<void>;
  nativeBrowserGoBack: (browserSessionId: string) => Promise<boolean>;
  nativeBrowserGoForward: (browserSessionId: string) => Promise<boolean>;
  nativeBrowserSetDesignState: (
    browserSessionId: string,
    state: NativeBrowserDesignState,
  ) => Promise<void>;
  nativeBrowserSetShortcuts: (chords: NativeBrowserChord[]) => Promise<void>;
  onNativeBrowserShortcut: (handler: (press: NativeBrowserKeyPress) => void) => () => void;
  onNativeBrowserDesignEvent: (handler: (event: NativeBrowserDesignEvent) => void) => () => void;
  onNativeBrowserLoaded: (handler: (event: NativeBrowserLoaded) => void) => () => void;
  onNativeBrowserLoadFailed: (handler: (event: NativeBrowserLoadFailed) => void) => () => void;
  onNativeBrowserWorking: (handler: (event: NativeBrowserWorking) => void) => () => void;
  onNativeBrowserAgentPoint: (handler: (event: NativeBrowserAgentPoint) => void) => () => void;
  onNativeBrowserAgentPress: (handler: (event: NativeBrowserAgentPress) => void) => () => void;
  onNativeBrowserFrame: (handler: (event: NativeBrowserFrame) => void) => () => void;
  onNativeBrowserClosed: (handler: (event: { browserSessionId: string }) => void) => () => void;
}

declare global {
  interface Window {
    droidex?: DroidexApi;
  }
}

interface DesktopPerformanceMetrics {
  timestamp: number;
  webContentsTotal: number;
  ptys: number;
  nativeBrowsers?: { sessions: number; live: number };
  terminals?: { live: number; retained: number; total: number };
  powerTier?: 'interactive' | 'hidden' | 'low-power';
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
  // Cumulative since app start, not per sample: difference polls for a rate.
  cpu: { userMs: number; systemMs: number };
}

export interface DesktopPowerTierSnapshot {
  tier: 'interactive' | 'hidden' | 'low-power';
  windowVisible: boolean;
  onBattery: boolean;
}

/** What a preview guest may read: one canvas's images and kit fonts, or kit fonts only. */
export type PreviewGuestBinding = { kind: 'canvas'; canvasId: string } | { kind: 'kit' };
