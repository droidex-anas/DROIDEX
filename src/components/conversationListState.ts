import type { FeedItem } from './chatFeed';
import { feedRowId } from '../hooks/conversationViewportAnchor';

export const CONVERSATION_LIST_OVERSCAN = 8;
export const CONVERSATION_LIST_ESTIMATE_PX = 96;
export const CONVERSATION_LIST_GAP_PX = 16;
export const CONVERSATION_LIST_PIN_THRESHOLD_PX = 80;
// A width change arrives as a stream of resize entries: the context panel
// animates the transcript's right inset for 200ms, and a window drag emits one
// entry per frame. Rows are re-measured once the width has stopped moving.
export const CONVERSATION_LIST_WIDTH_SETTLE_MS = 240;
// Pre-measure guess so the first window exists before the scroller is observed; a wrong size only changes overscan until measure.
export const CONVERSATION_LIST_INITIAL_RECT = { width: 720, height: 900 } as const;

export interface ConversationRowLookup {
  items: readonly FeedItem[];
  byMountKey: Map<string, number>;
  byViewportId: Map<string, number>;
}

export function estimatedListSize(count: number): number {
  if (count <= 0) return 0;
  return count * CONVERSATION_LIST_ESTIMATE_PX + Math.max(0, count - 1) * CONVERSATION_LIST_GAP_PX;
}

export function estimatedListEndOffset(
  count: number,
  viewportHeight: number = CONVERSATION_LIST_INITIAL_RECT.height,
): number {
  return Math.max(0, estimatedListSize(count) - viewportHeight);
}

export function isConversationAtLatest(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdPx: number = CONVERSATION_LIST_PIN_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < thresholdPx;
}

// Mutate only during commit: interrupted renders must not change find or anchor targets.
export function updateConversationRowLookup(
  previous: ConversationRowLookup | null,
  items: readonly FeedItem[],
  rebuiltFromIndex = 0,
): ConversationRowLookup {
  if (previous?.items === items) return previous;
  const lookup = previous ?? { items: [], byMountKey: new Map(), byViewportId: new Map() };
  const { byMountKey, byViewportId } = lookup;
  let start = Math.min(rebuiltFromIndex, lookup.items.length, items.length);
  if (lookup.items.at(0) !== items.at(0)) start = 0;
  // Projection can run more than once before a commit. Its rebuilt suffix has
  // new item identities; rewind through any earlier, uncommitted suffix too.
  while (start > 0 && lookup.items.at(start - 1) !== items.at(start - 1)) start -= 1;
  if (start === 0) {
    byMountKey.clear();
    byViewportId.clear();
  } else {
    for (let index = start; index < lookup.items.length; index += 1) {
      const item = lookup.items.at(index);
      if (!item) continue;
      byMountKey.delete(item.key);
      byViewportId.delete(feedRowId(item));
    }
  }
  for (let index = start; index < items.length; index += 1) {
    const item = items.at(index);
    if (!item) continue;
    byMountKey.set(item.key, index);
    byViewportId.set(feedRowId(item), index);
  }
  lookup.items = items;
  return lookup;
}

export function findConversationRowIndex(
  lookup: ConversationRowLookup,
  rowId: string,
): number | undefined {
  return lookup.byViewportId.get(rowId) ?? lookup.byMountKey.get(rowId);
}

export function scrollMarginBetween(list: HTMLElement, scroll: HTMLElement): number {
  return list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
}

export interface ConversationRowSizeChange {
  start: number;
  size: number;
  key: string | number | bigint;
}

export interface ConversationRowSizeChangeHost {
  isScrolling: boolean;
  scrollDirection: 'forward' | 'backward' | null;
  scrollAdjustments: number;
  itemSizeCache: { has: (key: string | number | bigint) => boolean };
  scrollOffset: number | null;
}

// Mirrors TanStack's default, except user-driven scroll: estimate→actual must
// not write scrollTop while the wheel already owns it.
export function shouldAdjustConversationRowOnSizeChange(
  item: ConversationRowSizeChange,
  _delta: number,
  instance: ConversationRowSizeChangeHost,
): boolean {
  if (instance.isScrolling) return false;
  const scrollOffsetWithAdj = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  const isFirstMeasure = !instance.itemSizeCache.has(item.key);
  if (isFirstMeasure) return item.start < scrollOffsetWithAdj;
  return item.start + item.size <= scrollOffsetWithAdj && instance.scrollDirection !== 'backward';
}

export function syncMeasureConversationList(
  list: HTMLElement,
  resizeItem: (index: number, size: number) => void,
  changedRows?: { items: readonly FeedItem[]; measured: WeakMap<Element, FeedItem> },
): void {
  for (let node = list.firstElementChild; node; node = node.nextElementSibling) {
    const row = node as HTMLElement;
    const index = Number(row.dataset.index);
    if (!Number.isInteger(index) || index < 0) continue;
    if (changedRows) {
      const item = changedRows.items.at(index);
      if (!item || changedRows.measured.get(node) === item) continue;
      changedRows.measured.set(node, item);
    }
    const size = Math.round(row.offsetHeight);
    resizeItem(index, size);
  }
}

export function nearestOverflowParent(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start.parentElement;
  while (node) {
    const overflowY =
      node.style.overflowY ||
      (typeof getComputedStyle === 'function' ? getComputedStyle(node).overflowY : '');
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

// A prompt sent moments ago always enters with motion, whatever the projection
// reported: its row can be rebuilt (a new session, a tail regroup) in the same
// tick it appears, which the append detection cannot see.
const JUST_SENT_MS = 2_000;

export function shouldAnimateFeedRow(
  item: { key: string; type: string; event?: { author?: string; ts: number } },
  animateKeys: ReadonlySet<string>,
  enteredKeys: ReadonlySet<string>,
  now = Date.now(),
): boolean {
  if (enteredKeys.has(item.key)) return false;
  if (animateKeys.has(item.key)) return true;
  if (item.type !== 'message' || item.event?.author !== 'user') return false;
  const age = now - item.event.ts;
  return age >= 0 && age < JUST_SENT_MS;
}
