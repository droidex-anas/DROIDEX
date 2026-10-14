import { isRecord } from '../../packages/remote/src/index';
import { remoteUsageSnapshot } from '../../packages/remote/src/usage';
import type {
  RemoteApproval,
  RemoteMessage,
  RemoteSession,
} from '../../packages/remote/src/application';

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}
function session(value: unknown): value is RemoteSession {
  return (
    isRecord(value) &&
    text(value.id, 128) &&
    text(value.title, 300) &&
    (value.provider === 'droid' || value.provider === 'claude' || value.provider === 'codex') &&
    (value.status === 'running' ||
      value.status === 'waiting' ||
      value.status === 'done' ||
      value.status === 'failed' ||
      value.status === 'paused') &&
    typeof value.supervised === 'boolean'
  );
}
function approval(value: unknown): value is RemoteApproval {
  return (
    isRecord(value) &&
    text(value.id, 128) &&
    text(value.sessionId, 128) &&
    text(value.title, 500) &&
    text(value.detail, 12_000) &&
    typeof value.risky === 'boolean'
  );
}

export function parseRemoteMessage(value: unknown): RemoteMessage {
  if (!isRecord(value)) throw new Error('Invalid laptop response.');
  switch (value.type) {
    case 'authorized':
      if (
        typeof value.expiresAt === 'number' &&
        Number.isSafeInteger(value.expiresAt) &&
        value.expiresAt >= 0
      )
        return { type: 'authorized', expiresAt: value.expiresAt };
      break;
    case 'locked':
      return { type: 'locked' };
    case 'pairing':
      if (text(value.deviceId, 128)) return { type: 'pairing', deviceId: value.deviceId };
      break;
    case 'usage':
      return { type: 'usage', snapshot: remoteUsageSnapshot(value.snapshot) };
    case 'result':
      if (
        typeof value.ok === 'boolean' &&
        text(value.message, 1_000) &&
        (value.operationId === undefined || text(value.operationId, 64))
      )
        return {
          type: 'result',
          ok: value.ok,
          message: value.message,
          ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
        };
      break;
    case 'stream':
    case 'history':
      if (text(value.sessionId, 128) && text(value.text, 40_000))
        return { type: value.type, sessionId: value.sessionId, text: value.text };
      break;
    case 'snapshot':
      if (
        Array.isArray(value.sessions) &&
        value.sessions.length <= 500 &&
        value.sessions.every(session) &&
        Array.isArray(value.approvals) &&
        value.approvals.length <= 100 &&
        value.approvals.every(approval)
      ) {
        if (
          value.pushPublicKey !== undefined &&
          (!text(value.pushPublicKey, 100) || !/^[A-Za-z0-9_-]{87}$/.test(value.pushPublicKey))
        )
          break;
        return {
          type: 'snapshot',
          sessions: value.sessions,
          approvals: value.approvals,
          ...(typeof value.pushPublicKey === 'string'
            ? { pushPublicKey: value.pushPublicKey }
            : {}),
        };
      }
      break;
  }
  throw new Error('The laptop sent an unsupported response. Update DROIDEX and reload this page.');
}
