import type { TranscriptEvent } from '../types/bridge';
import { isCancellationArtifact, type FeedItem } from './chatFeed';
import type { ChatFeedProjection, ChatFeedProjectorInput } from './chatFeedProjector';

// Only live, unmerged message rows qualify. Settled text can change answer
// merging and pinned-spec suppression.
export function projectTextTail(
  previous: ChatFeedProjection & { allTranscript: TranscriptEvent[] },
  input: ChatFeedProjectorInput,
  visiblePrefixLength: number,
  visibleSuffix: TranscriptEvent[],
): Extract<FeedItem, { type: 'message' }> | undefined {
  const row = previous.feedItems.at(-1);
  const before = previous.visibleTranscript.at(-1);
  const after = visibleSuffix[0];
  if (
    !input.pending ||
    input.transcriptMutation?.firstChangedIndex !== previous.allTranscript.length - 1 ||
    input.allTranscript.length !== previous.allTranscript.length ||
    visibleSuffix.length !== 1 ||
    visiblePrefixLength !== previous.visibleTranscript.length - 1 ||
    row?.type !== 'message' ||
    row.event !== before ||
    !isPlainTextGrowth(before, after)
  ) {
    return undefined;
  }
  return { ...row, event: after };
}

function isPlainTextGrowth(before: TranscriptEvent, after: TranscriptEvent): boolean {
  const previousText = before.text ?? '';
  const nextText = after.text;
  return (
    before.kind === 'text' &&
    after.kind === 'text' &&
    before.author !== 'user' &&
    after.author === before.author &&
    after.id === before.id &&
    after.ts === before.ts &&
    after.sourceSessionId === before.sourceSessionId &&
    !before.toolUseId &&
    !after.toolUseId &&
    nextText !== undefined &&
    nextText.length > previousText.length &&
    nextText.startsWith(previousText) &&
    !isCancellationArtifact(after)
  );
}
