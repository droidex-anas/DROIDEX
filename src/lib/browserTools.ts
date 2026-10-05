import type { TranscriptEvent } from '../types/bridge';
import { describeLink } from './linkPresentation';

// How DROIDEX's own browser tools read in the transcript: what the agent did on
// the page, in plain words, and the page that work left the browser on.

// The bare tool behind a call's name, whichever way the harness spells the
// server: `droidex-browser___browser_open`, `mcp__droidex-browser__browser_open`.
const BROWSER_TOOL = /^(?:mcp__)?droidex[-_]browser_{2,3}(browser_[a-z_]+)$/i;

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
  browser_fill_login: ['Filled in the saved login', 'Filling in the saved login'],
  browser_type: ['Typed', 'Typing'],
  browser_scroll: ['Scrolled', 'Scrolling'],
  browser_wait: ['Waited', 'Waiting'],
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
    return Object.hasOwn(HISTORY, text('action'))
      ? step(HISTORY[text('action')])
      : step(['Opened', 'Opening'], text('url'));
  }
  if (tool === 'browser_viewport') {
    // A call that names neither does nothing, and is not described as a change.
    if (!text('size') && !text('scheme')) return null;
    if (!text('size')) return step(['Changed the color scheme', 'Changing the color scheme']);
    return text('scheme')
      ? step(['Changed the page size and color scheme', 'Changing the page size and color scheme'])
      : step(['Changed the page size', 'Changing the page size']);
  }
  if (tool === 'browser_find') return step(['Looked for', 'Looking for'], text('query'));
  if (tool === 'browser_press') return step(['Pressed', 'Pressing'], text('key'));
  return Object.hasOwn(STEPS, tool) ? step(STEPS[tool]) : null;
}

export interface BrowserPage {
  title?: string;
  url: string;
  /** The address is an open's argument, not yet confirmed or redacted by its result. */
  pending?: boolean;
}

/** Whether the address is whole: one the tools redacted is not a link to hand out. */
export function isWholeUrl(url: string): boolean {
  return !url.includes('%5Bredacted%5D');
}

// A browser tool's answer ends with the page it left the browser on, on a line
// of its own: "[Title · url]". A screenshot's answer adds where it was saved.
const PAGE_LINE = /(?:^|\n)\[(.*) · (\S+)\](?:\nSaved at [^\n]*)?\s*$/;
// These hand back what the page itself wrote and name no page, so nothing in
// their answers is taken for one.
const PAGE_WORDS = new Set(['browser_console', 'browser_network', 'browser_inspect']);

/**
 * The page a turn's browser work is on: the one its latest answer names, or
 * the address it is opening when that open has not answered yet. `events` are
 * the turn's browser calls and their results, in order.
 */
export function browserPageOf(events: TranscriptEvent[]): BrowserPage | null {
  const callById = new Map(
    events
      .filter((event) => event.kind === 'tool_call' && event.toolUseId)
      .map((event) => [event.toolUseId, event]),
  );
  const answered = new Set<string | undefined>();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'tool_result') {
      answered.add(event.toolUseId);
      // A result with no id answers the call right before it.
      const call = event.toolUseId ? callById.get(event.toolUseId) : events[i - 1];
      const tool = call?.kind === 'tool_call' ? browserToolOf(call.toolName) : null;
      const line = PAGE_WORDS.has(tool ?? '') ? null : PAGE_LINE.exec(event.text ?? '');
      if (line) return { title: line[1] === 'Untitled' ? undefined : line[1], url: line[2] };
    } else if (browserToolOf(event.toolName) === 'browser_open' && !answered.has(event.toolUseId)) {
      // An open that failed or was refused never becomes the page.
      const url = describeBrowserCall('browser_open', event.toolArgs)?.object;
      if (url) return { url, pending: true };
    }
  }
  return null;
}

/**
 * What the agent is doing on the page right now: its latest call that has no
 * answer yet, or null when none is in flight.
 */
export function browserStepInFlight(events: TranscriptEvent[]): BrowserStep | null {
  const answered = new Set<string | undefined>();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'tool_result') answered.add(event.toolUseId);
    else {
      const tool = browserToolOf(event.toolName);
      if (tool && !event.interrupted && !answered.has(event.toolUseId))
        return describeBrowserCall(tool, event.toolArgs);
    }
  }
  return null;
}

// The step in flight in words, as the Browser card and the full-screen line
// say it ("Clicking Sign in"); an address being opened reads as its site,
// while a search reads as it was typed.
export function browserStepLabel(events: TranscriptEvent[]): string | null {
  const step = browserStepInFlight(events);
  if (!step) return null;
  const object =
    step.liveVerb === 'Opening' ? (describeLink(step.object)?.host ?? step.object) : step.object;
  return `${step.liveVerb} ${object}`.trim();
}
