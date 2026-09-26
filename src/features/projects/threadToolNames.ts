import { parseToolResultObject } from '../automations/toolNames';

/* The thread tools arrive namespaced by the harness that ran them
   (`droidex_sessions___thread_spawn`, `mcp__droidex-sessions__thread_spawn`), so
   the chat matches on the bare tool name. */

const THREAD_SERVER_PREFIXES: readonly string[] = ['droidex_sessions', 'mcp_droidex_sessions'];

export function isThreadSpawnCall(event: { kind?: string; toolName?: string }): boolean {
  return event.kind === 'tool_call' && threadToolBaseName(event.toolName) === 'thread_spawn';
}

export interface SpawnedChat {
  id: string;
  title: string;
  /** A thread of the chat that started it, or an ordinary sidebar chat. */
  reportBack: boolean;
}

/** What a settled spawn started, as the tool reported it. */
export function spawnedThread(value: string | undefined): SpawnedChat | null {
  const result = value ? parseToolResultObject(value) : null;
  if (result?.ok !== true || typeof result.title !== 'string') return null;
  if (result.reportBack === true && typeof result.threadId === 'string')
    return { id: result.threadId, title: result.title, reportBack: true };
  if (result.reportBack === false && typeof result.sessionId === 'string')
    return { id: result.sessionId, title: result.title, reportBack: false };
  return null;
}

function threadToolBaseName(name: string | undefined): string {
  if (!name) return '';
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const suffix = '_thread_spawn';
  if (normalized === 'thread_spawn') return 'thread_spawn';
  if (!normalized.endsWith(suffix)) return normalized;
  return THREAD_SERVER_PREFIXES.includes(normalized.slice(0, -suffix.length))
    ? 'thread_spawn'
    : normalized;
}
