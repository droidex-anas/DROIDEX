import type { AppState } from '../../hooks/useStore';
import type { TranscriptEvent } from '../../types/bridge';
import { isAppContextEvent } from '../../lib/composePrompt';
import { createIncrementalTranscriptFilter } from '../../lib/incrementalTranscriptFilter';

const EMPTY_EVENTS: TranscriptEvent[] = [];

interface ComposerTranscript {
  // What this user typed, oldest to newest, for ArrowUp recall.
  promptHistory: string[];
  hasAppContext: boolean;
}

// An agent's brief is a user-authored row too, but the composer recalls what
// the user typed, not what the chat sent to a subagent.
function isTypedPrompt(event: TranscriptEvent): boolean {
  return (
    event.author === 'user' &&
    event.kind === 'text' &&
    event.role === 'primary' &&
    Boolean(event.text?.trim())
  );
}

function withoutRepeats(prompts: readonly TranscriptEvent[]): string[] {
  const texts: string[] = [];
  for (const prompt of prompts) {
    const text = prompt.text ?? '';
    if (texts.at(-1) !== text) texts.push(text);
  }
  return texts;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// One per composer, so a store update only inspects the rows it changed.
export function createComposerTranscriptSelector(
  appSessionId: string | null,
  childSessionId: string | null,
): (state: Pick<AppState, 'transcripts' | 'transcriptMutations'>) => ComposerTranscript {
  const filterPrompts = createIncrementalTranscriptFilter();
  const filterAppContext = createIncrementalTranscriptFilter();
  const isTargetAppContext = (event: TranscriptEvent) => isAppContextEvent(event, childSessionId);
  let prompts: TranscriptEvent[] | undefined;
  let selection: ComposerTranscript = { promptHistory: [], hasAppContext: false };

  return (state) => {
    const input = {
      conversationKey: appSessionId ?? '',
      source: appSessionId ? (state.transcripts[appSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
      mutation: appSessionId ? state.transcriptMutations[appSessionId] : undefined,
    };
    const nextPrompts = filterPrompts({ ...input, includes: isTypedPrompt });
    const hasAppContext = filterAppContext({ ...input, includes: isTargetAppContext }).length > 0;
    let promptHistory = selection.promptHistory;
    if (nextPrompts !== prompts) {
      prompts = nextPrompts;
      const texts = withoutRepeats(nextPrompts);
      if (!sameStrings(texts, promptHistory)) promptHistory = texts;
    }
    if (promptHistory !== selection.promptHistory || hasAppContext !== selection.hasAppContext) {
      selection = { promptHistory, hasAppContext };
    }
    return selection;
  };
}
