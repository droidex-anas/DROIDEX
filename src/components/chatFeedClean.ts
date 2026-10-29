// A design chat reads as a conversation about the design: the prompts, the
// replies and the designs they made. The work between them (tool runs,
// thinking, narration) stays out, and while a turn runs one status line says
// what the agent is doing instead.

import type { TranscriptEvent } from '../types/bridge';
import type { FeedItem } from './chatFeed';

/**
 * Keeps prompts, designs, errors and notices, and a reply only when nothing
 * but replies follows it in its turn: narration before more work is a step,
 * not an answer.
 */
export function cleanFeed(items: readonly FeedItem[]): FeedItem[] {
  const kept: FeedItem[] = [];
  let workAfter = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    switch (item.type) {
      case 'message':
        if (item.event.author === 'user') {
          kept.push(item);
          workAfter = false;
        } else if (!workAfter) {
          kept.push(item);
        }
        break;
      case 'canvas_artifact':
      case 'generated_image':
        kept.push(item);
        workAfter = true;
        break;
      case 'error':
      case 'status':
        kept.push(item);
        break;
      default:
        workAfter = true;
    }
  }
  return kept.reverse();
}

/** What the design agent is doing now, read from the running turn's latest event. */
export function designWorkingLabel(events: readonly TranscriptEvent[]): string {
  const turnStart = events.findLastIndex((event) => event.author === 'user' && !event.steered);
  const turn = events.slice(turnStart + 1);
  const latest = turn.at(-1);
  const designed = turn.some(
    (event) =>
      event.canvasActivity?.state === 'completed' &&
      (event.canvasActivity.action === 'create' || event.canvasActivity.action === 'write'),
  );
  if (!latest) return 'Thinking the design';
  if (latest.kind === 'thinking') return 'Thinking the design';
  if (latest.kind === 'text') return 'Writing';
  if (latest.isError === true || latest.canvasActivity?.state === 'failed') return 'Fixing';
  return designed ? 'Iterating' : 'Designing';
}
