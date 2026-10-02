import type { TranscriptEvent } from '../types/bridge';

// How DROIDEX's own browser tools read in the transcript: what the agent did on
// the page, in plain words, and the page that work left the browser on.

// The bare tool behind a call's name, whichever way the harness spells the
// server: `droidex-browser___browser_open`, `mcp__droidex-browser__browser_open`.
const BROWSER_TOOL = /droidex[-_]browser_{2,3}(browser_[a-z_]+)$/i;

export function browserToolOf(name?: string): string | null {
  return BROWSER_TOOL.exec(name ?? '')?.[1].toLowerCase() ?? null;
}

export interface BrowserStep {
  // "Opened", "Read the page": what the row says once the call is done.
  verb: string;
  // The same step while the call is in flight: "Opening", "Reading the page".
  liveVerb: string;
  object: string;
}

type Verbs = [done: string, live: string];

const STEPS: Record<string, Verbs> = {
  browser_read_page: ['Read the page', 'Reading the page'],
  browser_read_text: ['Read the page text', 'Reading the page text'],
  browser_screenshot: ['Took a screenshot', 'Taking a screenshot'],
  browser_click: ['Clicked', 'Clicking'],
  browser_hover: ['Hovered', 'Hovering'],
  browser_fill: ['Filled in a field', 'Filling in a field'],
  browser_type: ['Typed', 'Typing'],
  browser_scroll: ['Scrolled', 'Scrolling'],
  browser_wait: ['Waited', 'Waiting'],
  browser_viewport: ['Changed the page size', 'Changing the page size'],
  browser_batch: ['Ran steps on the page', 'Running steps on the page'],
  browser_inspect: ['Inspected an element', 'Inspecting an element'],
  browser_network: ['Read network activity', 'Reading network activity'],
  browser_console: ['Read the console', 'Reading the console'],
  browser_evaluate: ['Ran a script', 'Running a script'],
};

const HISTORY: Record<string, Verbs> = {
  back: ['Went back', 'Going back'],
  forward: ['Went forward', 'Going forward'],
  reload: ['Reloaded the page', 'Reloading the page'],
};

// Only what the call itself says: a ref means nothing to a reader, and typed
// text may be something the user would not want repeated.
export function describeBrowserCall(tool: string, args: unknown): BrowserStep | null {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const text = (key: string) => (typeof record[key] === 'string' ? record[key] : '');
  const step = ([verb, liveVerb]: Verbs, object = ''): BrowserStep => ({ verb, liveVerb, object });
  if (tool === 'browser_open') {
    return text('action') in HISTORY
      ? step(HISTORY[text('action')])
      : step(['Opened', 'Opening'], text('url'));
  }
  if (tool === 'browser_find') return step(['Looked for', 'Looking for'], text('query'));
  if (tool === 'browser_press') return step(['Pressed', 'Pressing'], text('key'));
  return tool in STEPS ? step(STEPS[tool]) : null;
}

export interface BrowserPage {
  title?: string;
  url: string;
}

// A browser tool's answer ends with the page it left the browser on, on a line
// of its own: "[Title · url]".
const PAGE_LINE = /(?:^|\n)\[(.*) · (\S+)\]\s*$/;

/**
 * The page a turn's browser work is on: the one its latest answer names, or
 * the address it is opening when nothing has answered yet. `events` are the
 * turn's browser calls and their results, in order.
 */
export function browserPageOf(events: TranscriptEvent[]): BrowserPage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'tool_result') {
      const line = PAGE_LINE.exec(event.text ?? '');
      if (line) return { title: line[1] === 'Untitled' ? undefined : line[1], url: line[2] };
    } else if (browserToolOf(event.toolName) === 'browser_open') {
      const url = describeBrowserCall('browser_open', event.toolArgs)?.object;
      if (url) return { url };
    }
  }
  return null;
}

/** What the agent is doing on the page right now, or null when no call is in flight. */
export function browserStepInFlight(events: TranscriptEvent[]): BrowserStep | null {
  const call = events.findLast((event) => event.kind === 'tool_call');
  const tool = browserToolOf(call?.toolName);
  if (!call || !tool || call.interrupted) return null;
  const answered = events.some(
    (event) => event.kind === 'tool_result' && event.toolUseId === call.toolUseId,
  );
  return answered ? null : describeBrowserCall(tool, call.toolArgs);
}
