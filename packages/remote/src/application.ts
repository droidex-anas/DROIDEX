import { decodeBase64, encodeBase64, isRecord } from './crypto';

// Desktop API methods a paired browser may call. Everything else on the
// desktop API either drives the laptop's own window (native browser, dialogs,
// updates, relaunch, Remote pairing) or runs inside the browser itself.
export const REMOTE_DESKTOP_METHODS = [
  'sidecarStatus',
  'listDirectories',
  'saveImage',
  'saveAttachment',
  'discardImage',
  'listFiles',
  'getPerformanceMetrics',
  'readFile',
  'readLocalImage',
  'readRendererStorage',
  'writeSharedStorage',
  'repoStatus',
  'listEditors',
  'editorIcon',
  'openProject',
  'gitEnvironment',
  'gitBranches',
  'gitWorktrees',
  'gitDiffStat',
  'gitDiffFiles',
  'gitFileDiff',
  'gitMarkTurnStart',
  'gitAdoptTurnBaseline',
  'gitCreateBranch',
  'gitCheckout',
  'gitCreateWorktree',
  'gitRemoveWorktree',
  'gitCommit',
  'gitPush',
  'gitFetch',
  'githubAvailable',
  'githubInstall',
  'githubAuthenticate',
  'githubCancelSetup',
  'githubDetectPr',
  'githubListPrs',
  'githubViewPr',
  'githubPrDiff',
  'githubPrChecks',
  'githubPrComments',
  'githubCreatePr',
  'githubPostComment',
  'githubMergePr',
  'getOnboarding',
  'setOnboarding',
  'appVersion',
  'getAutomaticDiagnostics',
  'setAutomaticDiagnostics',
  'getUsageAnalytics',
  'setUsageAnalytics',
  'getApiKey',
  'setApiKey',
  'terminalCreate',
  'terminalResize',
  'terminalKill',
  'terminalHasChildren',
  'terminalList',
  'terminalUnsubscribe',
  'filesAuthorizeRoot',
  'filesList',
  'filesPreview',
  'filesOpen',
  'filesReveal',
] as const;
export type RemoteDesktopMethod = (typeof REMOTE_DESKTOP_METHODS)[number];

export const REMOTE_DESKTOP_EVENTS = [
  'onSidecarStatus',
  'onGithubAuthCode',
  'onSharedStorage',
] as const;
export type RemoteDesktopEvent = (typeof REMOTE_DESKTOP_EVENTS)[number];

// The web client deploys at once while laptops update later; both sides must
// speak the same tunnel protocol, so a browser stops at a mismatch.
export const REMOTE_PROTOCOL_VERSION = 1;

export interface RemoteAuth {
  type: 'auth';
  publicKey: JsonWebKey;
  signature: string;
  deviceName: string;
  code?: string;
}

/** Browser to laptop, inside the tunnel. */
export type RemoteRequest =
  | RemoteAuth
  | { type: 'ping' }
  // An unknown method gets a failed result, so a newer browser can ask an older laptop.
  | { type: 'call'; id: number; method: string; args: unknown[] }
  // Validated by the push backend, which owns the accepted endpoints.
  | { type: 'push.subscribe'; id: number; subscription: unknown }
  | { type: 'push.unsubscribe'; id: number }
  // `params` is the query string the renderer would open the local bridge with.
  | { type: 'bridge.open'; socketId: number; params: string }
  | { type: 'bridge.send'; socketId: number; data: string }
  | { type: 'bridge.close'; socketId: number }
  | { type: 'terminal.open'; terminalId: string }
  // An input or ack message for the terminal's port, checked by the port itself.
  | { type: 'terminal.post'; terminalId: string; message: unknown }
  | { type: 'terminal.close'; terminalId: string };

/** Laptop to browser, inside the tunnel. */
export type RemoteMessage =
  | { type: 'authorized'; protocol: number; expiresAt: number; pushPublicKey: string | null }
  | { type: 'pairing'; deviceId: string }
  | { type: 'locked' }
  | { type: 'denied' }
  | { type: 'removed' }
  | { type: 'pong' }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'event'; event: RemoteDesktopEvent; payload: unknown }
  | { type: 'bridge.opened'; socketId: number }
  | { type: 'bridge.message'; socketId: number; data: string }
  | { type: 'bridge.closed'; socketId: number; code: number; reason: string }
  | { type: 'terminal.message'; terminalId: string; message: unknown };

const MAX_CALL_ARGS = 8;
const MAX_BRIDGE_MESSAGE_CHARS = 8 * 1024 * 1024;

export function remoteRequest(value: unknown): RemoteRequest {
  if (!isRecord(value)) throw new Error('Invalid remote request');
  switch (value.type) {
    case 'auth':
      if (
        isRecord(value.publicKey) &&
        typeof value.signature === 'string' &&
        typeof value.deviceName === 'string' &&
        (value.code === undefined || typeof value.code === 'string')
      )
        return {
          type: 'auth',
          publicKey: value.publicKey,
          signature: value.signature,
          deviceName: value.deviceName,
          ...(typeof value.code === 'string' ? { code: value.code } : {}),
        };
      break;
    case 'ping':
      return { type: 'ping' };
    case 'push.unsubscribe':
      return { type: 'push.unsubscribe', id: requestId(value.id) };
    case 'push.subscribe':
      return { type: 'push.subscribe', id: requestId(value.id), subscription: value.subscription };
    case 'call':
      if (
        typeof value.method === 'string' &&
        value.method.length <= 128 &&
        Array.isArray(value.args) &&
        value.args.length <= MAX_CALL_ARGS
      )
        return {
          type: 'call',
          id: requestId(value.id),
          method: value.method,
          args: value.args.map(fromWire),
        };
      break;
    case 'bridge.open':
      if (typeof value.params === 'string' && value.params.length <= 1024)
        return { type: 'bridge.open', socketId: requestId(value.socketId), params: value.params };
      break;
    case 'bridge.send':
      if (typeof value.data === 'string' && value.data.length <= MAX_BRIDGE_MESSAGE_CHARS)
        return { type: 'bridge.send', socketId: requestId(value.socketId), data: value.data };
      break;
    case 'bridge.close':
      return { type: 'bridge.close', socketId: requestId(value.socketId) };
    case 'terminal.open':
    case 'terminal.close':
      return { type: value.type, terminalId: terminalId(value.terminalId) };
    case 'terminal.post':
      return {
        type: 'terminal.post',
        terminalId: terminalId(value.terminalId),
        message: value.message,
      };
  }
  throw new Error('Unsupported remote request');
}

export function remoteMessage(value: unknown): RemoteMessage {
  if (!isRecord(value)) throw new Error('Invalid laptop message');
  switch (value.type) {
    case 'authorized':
      if (
        Number.isSafeInteger(value.protocol) &&
        typeof value.protocol === 'number' &&
        Number.isSafeInteger(value.expiresAt) &&
        typeof value.expiresAt === 'number' &&
        (value.pushPublicKey === null || typeof value.pushPublicKey === 'string')
      )
        return {
          type: 'authorized',
          protocol: value.protocol,
          expiresAt: value.expiresAt,
          pushPublicKey: value.pushPublicKey,
        };
      break;
    case 'pairing':
      if (typeof value.deviceId === 'string') return { type: 'pairing', deviceId: value.deviceId };
      break;
    case 'locked':
    case 'denied':
    case 'removed':
    case 'pong':
      return { type: value.type };
    case 'result':
      if (value.ok === true)
        return { type: 'result', id: requestId(value.id), ok: true, value: fromWire(value.value) };
      if (value.ok === false && typeof value.error === 'string')
        return { type: 'result', id: requestId(value.id), ok: false, error: value.error };
      break;
    case 'event':
      if (isRemoteDesktopEvent(value.event))
        return { type: 'event', event: value.event, payload: value.payload };
      break;
    case 'bridge.opened':
      return { type: 'bridge.opened', socketId: requestId(value.socketId) };
    case 'bridge.message':
      if (typeof value.data === 'string')
        return { type: 'bridge.message', socketId: requestId(value.socketId), data: value.data };
      break;
    case 'bridge.closed':
      if (typeof value.code === 'number' && typeof value.reason === 'string')
        return {
          type: 'bridge.closed',
          socketId: requestId(value.socketId),
          code: value.code,
          reason: value.reason,
        };
      break;
    case 'terminal.message':
      return {
        type: 'terminal.message',
        terminalId: terminalId(value.terminalId),
        message: value.message,
      };
  }
  throw new Error('The laptop sent an unsupported message. Update DROIDEX and reload this page.');
}

/** Encodes byte arrays, which JSON would otherwise turn into index maps. */
export function toWire(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: encodeBase64(value) };
  if (Array.isArray(value)) return value.map(toWire);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = toWire(item);
  return result;
}

function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (!isRecord(value)) return value;
  if (typeof value.$bytes === 'string' && Object.keys(value).length === 1)
    return decodeBase64(value.$bytes);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = fromWire(item);
  return result;
}

export function isRemoteDesktopMethod(value: unknown): value is RemoteDesktopMethod {
  return REMOTE_DESKTOP_METHODS.some((method) => method === value);
}

function isRemoteDesktopEvent(value: unknown): value is RemoteDesktopEvent {
  return REMOTE_DESKTOP_EVENTS.some((event) => event === value);
}

function requestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid remote request id');
  return value;
}

function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128)
    throw new Error('Invalid terminal id');
  return value;
}
