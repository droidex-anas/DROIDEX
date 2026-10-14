export type RemoteProvider = 'droid' | 'claude' | 'codex';
export interface RemoteSession {
  id: string;
  title: string;
  provider: RemoteProvider;
  status: 'running' | 'waiting' | 'done' | 'failed' | 'paused';
  supervised: boolean;
}
export interface RemoteApproval {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  risky: boolean;
}
export type RemoteCommand =
  | {
      type: 'push.subscribe';
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    }
  | { type: 'push.unsubscribe' }
  | { type: 'list' }
  | { type: 'open'; sessionId: string }
  | { type: 'create'; text: string; provider: RemoteProvider }
  | { type: 'send'; sessionId: string; text: string }
  | { type: 'steer'; sessionId: string; text: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'pause'; sessionId: string }
  | { type: 'approval'; requestId: string; decision: 'approve' | 'deny' };
export type RemoteMessage =
  | {
      type: 'snapshot';
      sessions: RemoteSession[];
      approvals: RemoteApproval[];
      pushPublicKey?: string;
    }
  | { type: 'stream' | 'history'; sessionId: string; text: string }
  | { type: 'result'; ok: boolean; message: string; operationId?: string }
  | { type: 'authorized'; expiresAt: number }
  | { type: 'locked' }
  | { type: 'pairing'; deviceId: string };

export interface RemoteAuth {
  type: 'auth';
  publicKey: JsonWebKey;
  signature: string;
  deviceName: string;
  code?: string;
}

export function remoteCommand(value: unknown): RemoteCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid remote command');
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case 'list':
    case 'push.unsubscribe':
      return { type: command.type };
    case 'open':
    case 'stop':
    case 'pause':
      return { type: command.type, sessionId: commandString(command.sessionId, 128) };
    case 'approval':
      if (command.decision !== 'approve' && command.decision !== 'deny')
        throw new Error('Invalid approval decision');
      return {
        type: 'approval',
        requestId: commandString(command.requestId, 128),
        decision: command.decision,
      };
    case 'create':
      if (
        command.provider !== 'droid' &&
        command.provider !== 'claude' &&
        command.provider !== 'codex'
      )
        throw new Error('Invalid harness');
      return {
        type: 'create',
        text: commandString(command.text, 16_000),
        provider: command.provider,
      };
    case 'send':
    case 'steer':
      return {
        type: command.type,
        sessionId: commandString(command.sessionId, 128),
        text: commandString(command.text, 16_000),
      };
    default:
      throw new Error('Unsupported remote command');
  }
}
function commandString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new Error('Invalid remote command field');
  return value;
}
