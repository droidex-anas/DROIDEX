// A design chat reads as a conversation about the design: the prompts, the
// replies and the designs they made. The work between them (tool runs,
// thinking, narration) stays out, and while a turn runs one status line says
// what the agent is doing instead.

import {
  activeTodoIndex,
  isTodoTool,
  latestTodoSnapshot,
  toolMeta,
  type ToolCat,
} from '../lib/tools';
import type { TranscriptEvent } from '../types/bridge';
import type { FeedItem } from './chatFeed';

/**
 * Keeps prompts, designs, errors and notices, and a reply only when nothing
 * but replies follows it in its turn: narration before more work is a step,
 * not an answer. A turn's designs sit under its answer, the way a reply
 * presents what it made.
 */
export function cleanFeed(items: readonly FeedItem[]): FeedItem[] {
  // Walked backward, so every list holds its items last first.
  const kept: FeedItem[] = [];
  let answer: FeedItem[] = [];
  let designs: FeedItem[] = [];
  let workAfter = false;
  const closeTurn = () => {
    kept.push(...designs, ...answer);
    designs = [];
    answer = [];
    workAfter = false;
  };
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    switch (item.type) {
      case 'message':
        if (item.event.author === 'user') {
          closeTurn();
          kept.push(item);
        } else if (!workAfter) {
          answer.push(item);
        }
        break;
      case 'canvas_artifact':
        designs.push(item);
        workAfter = true;
        break;
      case 'generated_image':
        answer.push(item);
        workAfter = true;
        break;
      case 'error':
      case 'status':
        answer.push(item);
        break;
      case 'browser':
        // A finished turn sets its Browser card after the answer; it is not work after it.
        break;
      default:
        workAfter = true;
    }
  }
  closeTurn();
  return kept.reverse();
}

export interface DesignWorkingStatus {
  /** What the agent is doing now. */
  label: string;
  /** The plan step it is on, when the turn keeps a plan. */
  step?: { text: string; number: number; total: number };
}

const CANVAS_LABELS: Record<NonNullable<TranscriptEvent['canvasActivity']>['action'], string> = {
  create: 'Drawing the design',
  write: 'Refining the design',
  inspect: 'Looking at the canvas',
  arrange: 'Arranging the board',
  annotate: 'Adding notes',
  theme: 'Reading the design system',
};

const TOOL_LABELS: Partial<Record<ToolCat, string>> = {
  read: 'Reading',
  search: 'Searching',
  web: 'Looking it up',
  exec: 'Running a command',
  create: 'Writing files',
  edit: 'Editing files',
};

/** What the design agent is doing now, and the plan step it is on, read from the running turn. */
export function designWorkingStatus(events: readonly TranscriptEvent[]): DesignWorkingStatus {
  const turnStart = events.findLastIndex((event) => event.author === 'user' && !event.steered);
  const turn = events.slice(turnStart + 1);
  const label = workingLabel(turn.at(-1));
  const plan = latestTodoSnapshot(turn).todos;
  if (plan.every((item) => item.status === 'completed')) return { label };
  const index = activeTodoIndex(plan);
  return { label, step: { text: plan[index].text, number: index + 1, total: plan.length } };
}

function workingLabel(latest: TranscriptEvent | undefined): string {
  if (!latest || latest.kind === 'thinking') return 'Thinking';
  if (latest.kind === 'text') return 'Writing';
  const failed =
    latest.kind === 'error' || latest.isError === true || latest.canvasActivity?.state === 'failed';
  if (failed) return 'Fixing a problem';
  // A finished step leaves the agent deciding the next one.
  if (latest.kind !== 'tool_call') return 'Thinking';
  if (latest.canvasActivity) return CANVAS_LABELS[latest.canvasActivity.action];
  if (isTodoTool(latest.toolName)) return 'Planning';
  return TOOL_LABELS[toolMeta(latest.toolName, latest.toolArgs).cat] ?? 'Designing';
}
