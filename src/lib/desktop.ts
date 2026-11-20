import type { DesignSystemVersionRef, OwnedAsset, RevisionRef } from '@droidex/protocol';
import type { EditorId, EditorTarget } from './editorOpen';
import type { RepoStatus } from './repoEnvironment';
import type { AppIconMode } from './appIcon';
import type {
  BridgeInfo,
  SidecarSupervisorSnapshot,
  CanvasPreviewCaptureRequest,
  CanvasPreviewCaptureResult,
  CanvasExportResult,
  ProjectExportTarget,
  CanvasImageSaveResult,
  TerminalSessionInfo,
  TerminalDataChannel,
  SharedStorageKey,
  SharedStorageChange,
  FilesListing,
  FilePreviewPayload,
  NotifyOptions,
  NotifyResult,
  SaveImageResult,
  BridgeSocket,
  DroidexApi,
  DesktopPowerTierSnapshot,
  PreviewGuestBinding,
} from './desktopContract';

export function desktopApi(): DroidexApi | undefined {
  return typeof window !== 'undefined' ? window.droidex : undefined;
}

export const isDesktop = () => Boolean(desktopApi());

/** True in a DROIDEX Remote browser, where the laptop's own window features are out of reach. */
export const isRemoteClient = () => Boolean(desktopApi()?.remoteBrowser);

export const remoteBrowser = () => desktopApi()?.remoteBrowser;

export function openBridgeSocket(url: string): BridgeSocket {
  return desktopApi()?.openBridgeSocket?.(url) ?? new WebSocket(url);
}

export async function systemIdleTime(): Promise<number | null> {
  const api = desktopApi();
  if (!api) return null;
  const seconds = await api.systemIdleTime();
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function desktopPowerTier(): Promise<DesktopPowerTierSnapshot | null> {
  const api = desktopApi();
  if (!api) return null;
  try {
    return await api.powerTier();
  } catch {
    return null;
  }
}

export function onDesktopPowerTier(
  handler: (snapshot: DesktopPowerTierSnapshot) => void,
): () => void {
  const api = desktopApi();
  if (!api) return () => undefined;
  return api.onPowerTier(handler);
}

export function onDesktopMemoryPressure(handler: (payload: { at: number }) => void): () => void {
  const api = desktopApi();
  if (!api) return () => undefined;
  return api.onMemoryPressure(handler);
}

function requireDesktopApi(message: string): DroidexApi {
  const api = desktopApi();
  if (!api) throw new Error(message);
  return api;
}

export async function getBridgeInfo(): Promise<BridgeInfo> {
  const api = desktopApi();
  if (!api) return { port: 8765, token: '' };
  return api.bridgeInfo();
}

export async function getSidecarStatus(): Promise<SidecarSupervisorSnapshot | null> {
  const api = desktopApi();
  if (!api?.sidecarStatus) return null;
  return api.sidecarStatus();
}

export function onSidecarStatus(handler: (status: SidecarSupervisorSnapshot) => void): () => void {
  const api = desktopApi();
  if (!api?.onSidecarStatus) return () => undefined;
  return api.onSidecarStatus(handler);
}

export function writeSharedStorage(key: SharedStorageKey, value: string): void {
  const api = desktopApi();
  if (!api?.writeSharedStorage) return;
  void api.writeSharedStorage(key, value).catch(() => {
    // The other copies read the stored list when they next start.
  });
}

export function onSharedStorage(handler: (change: SharedStorageChange) => void): () => void {
  const api = desktopApi();
  if (!api?.onSharedStorage) return () => undefined;
  return api.onSharedStorage(handler);
}

export async function pickDirectory(): Promise<string | null> {
  const api = desktopApi();
  if (!api) return null;
  return api.pickDirectory();
}

export async function pickFiles(): Promise<string[]> {
  const api = desktopApi();
  if (!api) return [];
  try {
    return await api.pickFiles();
  } catch {
    return [];
  }
}

// Persists an image data URL into the temp attachments dir; the returned path
// is what the prompt @-mentions. Only the desktop app can write to disk.
export async function saveImage(dataUrl: string): Promise<string> {
  return requireDesktopApi('Image attachments need the desktop app.').saveImage(dataUrl);
}

// Asks where to save an image the viewer is showing and writes it there. The
// main process fetches it, since droidex-img bytes are unreadable to the page.
export async function saveImageAs(url: string, name: string): Promise<SaveImageResult> {
  return requireDesktopApi('Saving images needs the desktop app.').saveImageAs(url, name);
}

// Same store for pasted non-image files; the original name is kept (sanitized)
// in the saved filename so a restored chip still reads like the user's file.
export async function saveAttachment(name: string, dataUrl: string): Promise<string> {
  return requireDesktopApi('File attachments need the desktop app.').saveAttachment(name, dataUrl);
}

// Imports a dropped image into the canvas as an owned asset. Main rejects with
// a curated { code, message } that never names the file's path.
export async function importCanvasImage(canvasId: string, file: File): Promise<OwnedAsset> {
  return requireDesktopApi('Reference images need the desktop app.').canvasDropImage(
    canvasId,
    file,
  );
}

// Imports pasted SVG markup into the canvas as an owned asset, rejecting like importCanvasImage.
export async function importPastedSvg(canvasId: string, svg: string): Promise<OwnedAsset> {
  return requireDesktopApi('Pasting SVGs needs the desktop app.').canvasPasteSvg(canvasId, svg);
}

// Kit images (design system documents spec §8) enter the kit store only through
// main's picker or a drop; main rejects with a curated { code, message }.
export async function pickKitImage(): Promise<OwnedAsset | null> {
  return requireDesktopApi('Design system images need the desktop app.').canvasPickKitImage();
}

export async function importKitImage(file: File): Promise<OwnedAsset> {
  return requireDesktopApi('Design system images need the desktop app.').canvasDropKitImage(file);
}

// Main reads a kit image's bytes for the document: one can pass the bridge socket's buffer.
export async function readKitImage(
  assetId: string,
): Promise<{ mime: OwnedAsset['mediaType']; data: Uint8Array } | null> {
  return requireDesktopApi('Design system images need the desktop app.').canvasReadKitImage(
    assetId,
  );
}

// Absolute path behind a dropped or pasted File, or '' when there is none
// (clipboard snapshot, plain browser). A real path is attached by reference
// instead of being copied into the temp store.
export function pathForFile(file: File): string {
  const api = desktopApi();
  if (!api?.pathForFile) return '';
  try {
    return api.pathForFile(file);
  } catch {
    return '';
  }
}

export async function discardImage(path: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  try {
    await api.discardImage(path);
  } catch {
    /* already gone */
  }
}

export async function notify(
  title: string,
  body: string,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const api = desktopApi();
  if (!api) return { shown: false, reason: 'unsupported' };
  return api.notify(title, body, options);
}

/** Subscribe to notification clicks that should open a specific chat. */
export function onNotificationActivate(
  handler: (payload: { appSessionId: string }) => void,
): () => void {
  const api = desktopApi();
  if (!api) return () => undefined;
  return api.onNotificationActivate(handler);
}

/** Pull a pending open-session request queued by a notification click. */
export async function takePendingNotificationSession(): Promise<{
  appSessionId: string;
} | null> {
  const api = desktopApi();
  if (!api) return null;
  const pending = await api.takePendingNotificationSession();
  if (!pending || typeof pending.appSessionId !== 'string' || !pending.appSessionId.trim()) {
    return null;
  }
  return { appSessionId: pending.appSessionId.trim() };
}

export async function ackNotificationActivate(appSessionId: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  try {
    await api.ackNotificationActivate(appSessionId);
  } catch {
    /* ignore */
  }
}

export async function getApiKey(): Promise<string | null> {
  const api = desktopApi();
  if (!api) return null;
  return api.getApiKey();
}

export async function setApiKey(key: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.setApiKey(key);
}

export async function setAppIcon(mode: AppIconMode): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.setAppIcon(mode);
}

export async function createTerminal(options: {
  appSessionId: string;
  cwd: string;
  cols: number;
  rows: number;
}): Promise<TerminalSessionInfo> {
  return requireDesktopApi('Terminal is only available in the desktop app.').terminalCreate(
    options,
  );
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.terminalResize(id, cols, rows);
}

export async function killTerminal(id: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.terminalKill(id);
}

export async function terminalHasChildren(id: string): Promise<boolean> {
  const api = desktopApi();
  if (!api) return false;
  return api.terminalHasChildren(id);
}

export async function listTerminals(appSessionId: string): Promise<TerminalSessionInfo[]> {
  const api = desktopApi();
  if (!api) return [];
  return api.terminalList(appSessionId);
}

export function subscribeTerminal(id: string): TerminalDataChannel | null {
  const api = desktopApi();
  if (!api) return null;
  return api.terminalSubscribe(id);
}

export async function unsubscribeTerminal(id: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.terminalUnsubscribe(id);
}

export async function authorizeFilesRoot(root: string): Promise<string> {
  return requireDesktopApi('Files are only available in the desktop app.').filesAuthorizeRoot(root);
}

export async function listDirectory(accessToken: string, relative = ''): Promise<FilesListing> {
  return requireDesktopApi('Files are only available in the desktop app.').filesList(
    accessToken,
    relative,
  );
}

export async function readFilePreview(
  accessToken: string,
  relative: string,
): Promise<FilePreviewPayload> {
  return requireDesktopApi('Files are only available in the desktop app.').filesPreview(
    accessToken,
    relative,
  );
}

export async function openFileDefault(accessToken: string, relative: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.filesOpen(accessToken, relative);
}

export async function revealFile(accessToken: string, relative: string): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.filesReveal(accessToken, relative);
}

export async function listFiles(dir: string): Promise<string[]> {
  const api = desktopApi();
  if (!api) return [];
  try {
    return await api.listFiles(dir);
  } catch {
    return [];
  }
}

export async function readFile(path: string): Promise<string | null> {
  const api = desktopApi();
  if (!api) return null;
  try {
    return await api.readFile(path);
  } catch {
    return null;
  }
}

export async function getRepoStatus(dir: string): Promise<RepoStatus | null> {
  const api = desktopApi();
  if (!api) return null;
  try {
    return await api.repoStatus(dir);
  } catch {
    return null;
  }
}

export async function openProject(
  dir: string,
  editor: EditorId,
  target: EditorTarget,
): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  await api.openProject(dir, editor, target);
}

export async function listEditors(): Promise<EditorId[]> {
  const api = desktopApi();
  if (!api) return [];
  try {
    return await api.listEditors();
  } catch {
    return [];
  }
}

export async function editorIcon(editor: EditorId): Promise<string | null> {
  const api = desktopApi();
  if (!api) return null;
  try {
    return await api.editorIcon(editor);
  } catch {
    return null;
  }
}

/** The owned source every Canvas live preview guest loads (spec §6). */
export function canvasPreviewUrl(): string | null {
  return desktopApi()?.canvasPreviewUrl ?? null;
}

export async function bindCanvasPreviewGuest(
  guestId: number,
  binding: PreviewGuestBinding,
): Promise<boolean> {
  const api = desktopApi();
  if (!api) return false;
  return api.canvasPreviewBind(guestId, binding);
}

/**
 * Asks main to end one preview guest. Main owns the registry of guests it
 * attached, so it refuses an ID it does not recognise and never consults the
 * guest; false means nothing was ended.
 */
export async function terminateCanvasPreviewGuest(guestId: number): Promise<boolean> {
  const api = desktopApi();
  if (!api) return false;
  return api.canvasPreviewTerminate(guestId);
}

export async function captureCanvasPreview(
  request: CanvasPreviewCaptureRequest,
): Promise<CanvasPreviewCaptureResult> {
  const api = desktopApi();
  if (!api)
    return {
      ok: false,
      error: { code: 'capture_unavailable', message: 'Open this design in DROIDEX to capture it.' },
    };
  return api.canvasPreviewCapture(request);
}

export async function cancelCanvasPreviewCapture(requestId: string): Promise<void> {
  await desktopApi()?.canvasPreviewCancelCapture(requestId);
}

export async function readCanvasThumbnail(
  canvasId: string,
  designId: string,
  revisionId: string,
): Promise<Uint8Array | null> {
  return (await desktopApi()?.canvasThumbnailRead(canvasId, designId, revisionId)) ?? null;
}

export async function saveCanvasImage(
  requestId: string,
  suggestedName: string,
): Promise<CanvasImageSaveResult> {
  const api = desktopApi();
  if (!api)
    return { ok: false, code: 'capture_unavailable', message: 'Open DROIDEX to save this image.' };
  return api.canvasImageSave(requestId, suggestedName);
}

export async function saveCanvasSvg(
  svg: string,
  suggestedName: string,
): Promise<CanvasImageSaveResult> {
  const api = desktopApi();
  if (!api)
    return { ok: false, code: 'capture_unavailable', message: 'Open DROIDEX to save this image.' };
  return api.canvasSvgSave(svg, suggestedName);
}

/**
 * Writes one revision's source into a folder of its chat's project, without a
 * chooser. Aborting `signal` cancels the export before it is published.
 */
export async function exportCanvasToProject(
  canvasId: string,
  ref: RevisionRef,
  project: ProjectExportTarget,
  signal: AbortSignal,
): Promise<CanvasExportResult> {
  const api = desktopApi();
  if (!api)
    return { ok: false, code: 'storage_failed', message: 'Open DROIDEX to export a design.' };
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void api.canvasExportSourceCancel(requestId).catch(() => {
      // A request main no longer holds has nothing left to cancel.
    });
  };
  signal.addEventListener('abort', cancel);
  try {
    return await api.canvasExportSource(canvasId, ref, { ...project, requestId });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** Opens the host's folder chooser, then writes one kit version there. */
export async function exportDesignSystem(ref: DesignSystemVersionRef): Promise<CanvasExportResult> {
  const api = desktopApi();
  if (!api)
    return {
      ok: false,
      code: 'storage_failed',
      message: 'Open DROIDEX to export a design system.',
    };
  return api.canvasExportDesignSystem(ref);
}
