import { useSyncExternalStore } from 'react';
import { removeDesignReferences } from '../../lib/commands';
import type { NativeBrowserSelection } from '../../lib/nativeBrowser';
import type {
  BrowserViewport,
  DesignReference,
  DesignSelectionScreenshot,
} from '../../types/bridge';

// The marks a chat has picked in its browser page and not sent yet: each one a
// design reference whose anchor carries its number. They show as chips in the
// composer and as numbered outlines on the page, and go out with the next
// prompt.
//
// A mark is known by its anchor's id, which the page gives the element, area
// or sketch; each pick of it is a new reference with an id of its own, so a
// prompt already queued keeps the snapshots it was sent with. Numbers only
// grow while a mark, the draft or a queued prompt may still say @N, so an @N
// already written never comes to mean another mark.

const NONE: readonly DesignReference[] = [];
let marksByChat: Readonly<Record<string, readonly DesignReference[] | undefined>> = {};
// The last number given out in each chat.
const lastNumber = new Map<string, number>();
const listeners = new Set<() => void>();
// Crops still being taken, by pick id. Main answers every pick, with a crop or
// without one, so a prompt sent meanwhile can wait for the crops of its marks.
const shotsDue = new Map<string, Promise<DesignSelectionScreenshot | undefined>>();
const settleShot = new Map<string, (shot?: DesignSelectionScreenshot) => void>();
// The longest a prompt waits for a crop: past main's own limit for taking one.
const SHOT_WAIT_MS = 8_000;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The sidecar holds the chat's live marks for the agent to read; one the user
// took away or picked again is forgotten there too. A prompt sends its own
// snapshots, so nothing sent depends on them staying.
function set(appSessionId: string, marks: readonly DesignReference[]): void {
  const kept = new Set(marks.map((mark) => mark.id));
  const gone = designMarks(appSessionId)
    .filter((mark) => !kept.has(mark.id))
    .map((mark) => mark.id);
  marksByChat = { ...marksByChat, [appSessionId]: marks.length > 0 ? marks : undefined };
  if (gone.length > 0) removeDesignReferences(appSessionId, gone);
  for (const listener of listeners) listener();
}

export function designMarks(appSessionId: string | undefined): readonly DesignReference[] {
  return (appSessionId ? marksByChat[appSessionId] : undefined) ?? NONE;
}

export function useDesignMarks(appSessionId: string | undefined): readonly DesignReference[] {
  return useSyncExternalStore(
    subscribe,
    () => designMarks(appSessionId),
    () => NONE,
  );
}

/** A pick as a reference, under an id no other pick has, at the page size it was made at. */
export function designReferenceFor(
  selection: NativeBrowserSelection,
  viewport: BrowserViewport | undefined,
): DesignReference {
  return {
    id: `${selection.anchor.id}-${crypto.randomUUID().slice(0, 8)}`,
    anchor: { ...selection.anchor, strokes: selection.anchor.strokes ?? selection.strokes },
    detail: selection.detail,
    url: selection.url,
    title: selection.title,
    viewport,
    scroll: selection.scroll,
    screenshot: selection.screenshot,
  };
}

/** Notes that the crop of this pick is being taken. */
export function expectDesignShot(id: string): void {
  shotsDue.set(
    id,
    new Promise((resolve) => {
      settleShot.set(id, resolve);
    }),
  );
}

/** The crop of this pick came, or will not. */
export function settleDesignShot(id: string, screenshot?: DesignSelectionScreenshot): void {
  settleShot.get(id)?.(screenshot);
  settleShot.delete(id);
  shotsDue.delete(id);
}

/** The marks with the crops still being taken of them, waited for a moment at most. */
export async function withDesignShots(
  marks: readonly DesignReference[],
): Promise<DesignReference[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, SHOT_WAIT_MS, undefined);
  });
  try {
    return await Promise.all(
      marks.map(async (mark) => {
        const due = shotsDue.get(mark.id);
        const screenshot = due && (await Promise.race([due, late]));
        return screenshot ? { ...mark, screenshot } : mark;
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Adds a pick as the next mark, or as the mark it picks again; returns it numbered. */
export function addDesignMark(appSessionId: string, pick: DesignReference): DesignReference {
  const marks = designMarks(appSessionId);
  const existing = marks.find((mark) => mark.anchor.id === pick.anchor.id);
  const number = existing?.anchor.mark ?? (lastNumber.get(appSessionId) ?? 0) + 1;
  noteNumber(appSessionId, number);
  const numbered = { ...pick, anchor: { ...pick.anchor, mark: number } };
  set(
    appSessionId,
    existing ? marks.map((mark) => (mark === existing ? numbered : mark)) : [...marks, numbered],
  );
  return numbered;
}

/** Gives a pick its crop, if it is still a mark; returns the mark with it. */
export function attachDesignShot(
  appSessionId: string,
  id: string,
  screenshot: DesignSelectionScreenshot,
): DesignReference | undefined {
  const marks = designMarks(appSessionId);
  const mark = marks.find((candidate) => candidate.id === id);
  if (!mark) return undefined;
  const shot = { ...mark, screenshot };
  set(
    appSessionId,
    marks.map((candidate) => (candidate === mark ? shot : candidate)),
  );
  return shot;
}

/** Takes away the mark with this anchor id. */
export function removeDesignMark(appSessionId: string, anchorId: string): void {
  set(
    appSessionId,
    designMarks(appSessionId).filter((mark) => mark.anchor.id !== anchorId),
  );
}

/** Replaces the chat's marks, as when a queued design prompt comes back to the composer. */
export function setDesignMarks(appSessionId: string, marks: readonly DesignReference[]): void {
  for (const mark of marks) noteNumber(appSessionId, mark.anchor.mark ?? 0);
  set(appSessionId, marks);
}

function noteNumber(appSessionId: string, number: number): void {
  lastNumber.set(appSessionId, Math.max(number, lastNumber.get(appSessionId) ?? 0));
}

/** Numbers start again at 1, once the chat has no marks and nothing says @N. */
export function restartDesignMarkNumbers(appSessionId: string): void {
  if (designMarks(appSessionId).length === 0) lastNumber.delete(appSessionId);
}

/** Drops the marks of a chat whose browser has closed or gone away. */
export function dropDesignMarks(appSessionId: string): void {
  if (!marksByChat[appSessionId]) return;
  set(appSessionId, []);
  lastNumber.delete(appSessionId);
}

/** The chip's name: the component, else the element's name or text, else its tag. */
export function designMarkLabel(mark: DesignReference): string {
  const { anchor } = mark;
  if (anchor.kind !== 'element') return anchor.strokes ? 'Sketch' : 'Area';
  return anchor.source?.component ?? anchor.name ?? anchor.text ?? anchor.tag ?? anchor.label;
}

/**
 * The colour of design marks, on the page and on their chips. A neutral accent
 * (near-white on dark, near-black on light) would vanish on most pages, so the
 * marks then take the link colour, as links do.
 */
export function designMarkColor(): string {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--droid-accent').trim();
  return isNeutral(accent) ? css.getPropertyValue('--droid-link').trim() : accent;
}

function isNeutral(color: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return false;
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex;
  const channels = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels) < 24;
}
