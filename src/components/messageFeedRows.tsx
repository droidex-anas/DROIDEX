import { memo, useEffect, useRef } from 'react';

import { feedRowId } from '../hooks/conversationViewportAnchor';
import {
  feedRowReachClassName,
  useTranscriptReachChrome,
} from '../features/transcript-reach/transcriptReachContext';
import { hasAppBlock } from './appBlockRuntime';
import { FeedItemView, feedItemPropsEqual, type FeedItemViewProps } from './chat';

export interface FeedRowProps extends FeedItemViewProps {
  animateOnMount: boolean;
  onEnter?: (key: string) => void;
}

export function areFeedRowPropsEqual(previous: FeedRowProps, next: FeedRowProps): boolean {
  return previous.onEnter === next.onEnter && feedItemPropsEqual(previous, next);
}

export const FeedRow = memo(function FeedRow(props: FeedRowProps) {
  const { animateOnMount, onEnter, ...itemProps } = props;
  const { item } = itemProps;
  const animate = useRef(animateOnMount).current;
  useEffect(() => {
    if (animate) onEnter?.(item.key);
  }, [animate, onEnter, item.key]);
  const isPrompt = item.type === 'message' && item.event.author === 'user';
  const isMessage = item.type === 'message';
  const isWideAppResponse =
    item.type === 'message' && item.event.author !== 'user' && hasAppBlock(item.event.text ?? '');
  const entranceClass = isPrompt ? 'prompt-enter' : 'feed-row-enter';
  const rowId = feedRowId(item);
  const reach = useTranscriptReachChrome();
  const reachClass = feedRowReachClassName({
    rowId,
    itemKey: item.key,
    activeRowId: reach.activeRowId,
    matchRowIds: reach.matchRowIds,
    rangeStartKey: reach.rangeStartKey,
    rangeEndKey: reach.rangeEndKey,
  });
  const hit = feedRowHitKind(rowId, reach.activeRowId, reach.matchRowIds);

  return (
    <div
      data-feed-row-id={rowId}
      data-anchor-id={isPrompt ? item.key : undefined}
      data-transcript-find-hit={hit}
      // A prompt opens a turn, so it carries a little extra air above the
      // shared row gap and the transcript reads as turns, not as a flat list.
      // A message also keeps air below: its copy control sits in the gap and
      // needs clearance from whatever follows. Both are constant, so a row's
      // height never changes when a turn settles.
      className={`mx-auto min-w-0 ${isWideAppResponse ? 'max-w-4xl' : 'max-w-2xl'} ${
        isPrompt ? 'pt-2' : ''
      } ${isMessage ? 'pb-2' : ''} ${animate ? entranceClass : ''} ${reachClass}`}
    >
      {reach.rangeSelecting && (
        <button
          type="button"
          data-testid="transcript-range-row"
          aria-label="Select this row for range copy"
          onClick={() => {
            reach.onSelectRangeRow(item.key);
          }}
          className="mb-1 rounded-md border border-droid-border px-1.5 py-0.5 text-[11px] text-droid-text-muted hover:text-droid-text"
        >
          {rangeRowLabel(item.key, reach.rangeStartKey, reach.rangeEndKey)}
        </button>
      )}
      <FeedItemView {...itemProps} />
    </div>
  );
}, areFeedRowPropsEqual);

function feedRowHitKind(
  rowId: string,
  activeRowId: string | null,
  matchRowIds: ReadonlySet<string>,
): 'active' | 'match' | undefined {
  if (activeRowId === rowId) return 'active';
  if (matchRowIds.has(rowId)) return 'match';
  return undefined;
}

function rangeRowLabel(
  itemKey: string,
  rangeStartKey: string | null,
  rangeEndKey: string | null,
): string {
  if (rangeStartKey === itemKey) return 'Range start';
  if (rangeEndKey === itemKey) return 'Range end';
  return 'Add to range';
}
