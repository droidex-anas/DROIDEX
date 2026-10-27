import { browserToolOf } from '../../lib/browserTools';
import { transcriptEventIsVisible } from '../../lib/childSessions';
import type { TranscriptEvent } from '../../types/bridge';
import { startsTurn } from '../chatFeed';

type ComputerUseActivity = { kind: 'browser' } | { kind: 'computer'; image?: string };

const CUA_TOOL = /^mcp__cua[-_]repl__js$/;
const EXEC_TOOL = /^(?:functions\.exec|mcp__functions__exec)$/;
const FORWARDED_CUA = /\btools\.mcp__cua[-_]repl__js\s*\(/;
const CUA_API = /\bcua\.(?:getApp|getBrowser|getTab|createBrowserTab|getState)\s*\(/;

function isComputerCall(event: TranscriptEvent): boolean {
  if (CUA_TOOL.test(event.toolName ?? '')) return true;
  if (!EXEC_TOOL.test(event.toolName ?? '')) return false;
  const args = event.toolArgs;
  let code = '';
  if (typeof args === 'string') code = args;
  else if (args && typeof args === 'object' && 'code' in args && typeof args.code === 'string')
    code = args.code;
  return FORWARDED_CUA.test(code) || CUA_API.test(code);
}

function activityKind(event: TranscriptEvent): 'browser' | 'computer' | null {
  if (event.interrupted || event.isError) return null;
  if (event.kind === 'tool_result') return CUA_TOOL.test(event.toolName ?? '') ? 'computer' : null;
  if (event.kind !== 'tool_call') return null;
  if (browserToolOf(event.toolName)) return 'browser';
  return isComputerCall(event) ? 'computer' : null;
}

function currentTurnStart(events: TranscriptEvent[], childSessionId: string | null): number | null {
  let start: number | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!transcriptEventIsVisible(event, childSessionId)) continue;
    if (startsTurn(event) && !event.steered) return index;
    start = 0;
  }
  return start;
}

function latestComputerImage(
  events: TranscriptEvent[],
  turnStart: number,
  childSessionId: string | null,
  computerCalls: Set<string>,
): string | undefined {
  for (let index = events.length - 1; index >= turnStart; index -= 1) {
    const event = events[index];
    if (
      !transcriptEventIsVisible(event, childSessionId) ||
      event.kind !== 'tool_result' ||
      event.isError ||
      event.interrupted ||
      !event.toolUseId ||
      !computerCalls.has(event.toolUseId)
    )
      continue;
    const images = event.images;
    const image = images?.[images.length - 1];
    if (image) return image;
  }
  return undefined;
}

/** The latest computer-use surface in the visible session's current turn. */
export function computerUseActivity(
  events: TranscriptEvent[],
  childSessionId: string | null = null,
): ComputerUseActivity | null {
  const turnStart = currentTurnStart(events, childSessionId);
  if (turnStart === null) return null;

  let activity: ComputerUseActivity | null = null;
  const computerCalls = new Set<string>();
  for (let index = turnStart; index < events.length; index += 1) {
    const event = events[index];
    if (!transcriptEventIsVisible(event, childSessionId)) continue;
    const kind = activityKind(event);
    if (!kind) continue;
    activity = { kind };
    if (kind === 'computer' && event.toolUseId) computerCalls.add(event.toolUseId);
  }
  if (activity?.kind !== 'computer') return activity;

  // Collect calls first: restored history can deliver a result before its call.
  const image = latestComputerImage(events, turnStart, childSessionId, computerCalls);
  if (image) return { ...activity, image };
  return activity;
}
