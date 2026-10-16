import { useEffect, useRef, type Dispatch } from 'react';
import { ChevronDown, ChevronUp, Copy, Search, X, type IconComponent } from '@droidex/icons';
import { Button } from '../../components/ui/Button';

import type { TranscriptReachAction, TranscriptReachState } from './transcriptReachState';
import type { transcriptFindScopeNotice } from './transcriptFind';

export function TranscriptReachBar({
  state,
  dispatch,
  countLabel,
  scopeNotice,
  onLoadOlder,
  onCopyRange,
  copied,
}: {
  state: TranscriptReachState;
  dispatch: Dispatch<TranscriptReachAction>;
  countLabel: string;
  scopeNotice: ReturnType<typeof transcriptFindScopeNotice>;
  onLoadOlder: () => void;
  onCopyRange: () => void;
  copied: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state.open]);

  if (!state.open) return null;

  const onSubmit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    dispatch({ type: 'next' });
  };

  const rangeReady = Boolean(state.rangeStartKey && state.rangeEndKey);
  const hasQuery = state.query.trim().length > 0;

  return (
    <div
      role="search"
      data-testid="transcript-find-bar"
      className="pointer-events-auto flex max-w-2xl flex-col gap-1.5 rounded-lg bg-raised px-2 py-1.5 shadow-lg"
    >
      <form onSubmit={onSubmit} className="flex items-center gap-1.5">
        <Search className="size-icon-sm shrink-0 text-muted" />
        <input
          ref={inputRef}
          data-testid="transcript-find-input"
          value={state.query}
          onChange={(event) => {
            dispatch({ type: 'setQuery', query: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault();
              dispatch({ type: 'prev' });
            }
          }}
          placeholder="Find in conversation"
          aria-label="Find in conversation"
          className="min-w-0 flex-1 bg-transparent text-body text-primary placeholder-muted focus:outline-none"
        />
        <span
          data-testid="transcript-find-count"
          className="shrink-0 text-caption tabular-nums text-muted"
        >
          {hasQuery ? countLabel : ''}
        </span>
        <IconButton
          testId="transcript-find-prev"
          title="Previous match"
          icon={ChevronUp}
          disabled={!hasQuery || state.matches.length === 0}
          onClick={() => {
            dispatch({ type: 'prev' });
          }}
        />
        <IconButton
          testId="transcript-find-next"
          title="Next match"
          icon={ChevronDown}
          disabled={!hasQuery || state.matches.length === 0}
          onClick={() => {
            dispatch({ type: 'next' });
          }}
        />
        <IconButton
          testId="transcript-range-toggle"
          title="Copy a range of messages"
          icon={Copy}
          active={state.rangeSelecting}
          onClick={() => {
            dispatch({ type: state.rangeSelecting ? 'cancelRange' : 'beginRange' });
          }}
        />
        <IconButton
          testId="transcript-find-close"
          title="Close"
          icon={X}
          onClick={() => {
            dispatch({ type: 'close' });
          }}
        />
      </form>
      {scopeNotice && (
        <div
          role="status"
          data-testid="transcript-find-scope"
          className="flex flex-wrap items-center gap-2 px-1 text-caption text-muted"
        >
          <span>{scopeNoticeMessage(scopeNotice)}</span>
          {scopeNotice.kind === 'older-history' && (
            <Button size="sm" data-testid="transcript-find-load-older" onClick={onLoadOlder}>
              Load older history
            </Button>
          )}
        </div>
      )}
      {state.rangeSelecting && (
        <div
          data-testid="transcript-range-bar"
          className="flex flex-wrap items-center gap-2 px-1 text-caption text-muted"
        >
          <span>{rangePrompt(rangeReady, state.rangeStartKey)}</span>
          {activeMatchActions(state, dispatch)}
          <Button
            size="sm"
            data-testid="transcript-range-copy"
            disabled={!rangeReady}
            onClick={onCopyRange}
          >
            {copied ? 'Copied' : 'Copy range'}
          </Button>
        </div>
      )}
    </div>
  );
}

function activeMatchActions(
  state: TranscriptReachState,
  dispatch: Dispatch<TranscriptReachAction>,
) {
  const match = state.matches.at(state.activeIndex);
  if (!match) return null;
  return (
    <>
      <Button
        size="sm"
        data-testid="transcript-range-from-match-start"
        onClick={() => {
          dispatch({ type: 'setRangeBound', bound: 'start', itemKey: match.itemKey });
        }}
      >
        Start at match
      </Button>
      <Button
        size="sm"
        data-testid="transcript-range-from-match-end"
        onClick={() => {
          dispatch({ type: 'setRangeBound', bound: 'end', itemKey: match.itemKey });
        }}
      >
        End at match
      </Button>
    </>
  );
}

function IconButton({
  title,
  icon,
  onClick,
  disabled,
  active,
  testId,
}: {
  title: string;
  icon: IconComponent;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={icon}
      data-testid={testId}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function scopeNoticeMessage(
  notice: NonNullable<ReturnType<typeof transcriptFindScopeNotice>>,
): string {
  if (notice.kind === 'loading-older') return 'Loading older history…';
  if (notice.empty) return 'Older history isn’t loaded, so this can miss earlier turns.';
  return 'Showing matches in loaded history. Older turns may also match.';
}

function rangePrompt(rangeReady: boolean, rangeStartKey: string | null): string {
  if (rangeReady) return 'Range selected from conversation state.';
  if (rangeStartKey) return 'Click the last message to copy.';
  return 'Click the first message, then the last.';
}
