import { useEffect, useState } from 'react';
import { useStoreApi, type AppState } from '../../hooks/useStore';
import { voiceSessionOf, type VoiceTranscriptLine } from './voiceSessions';

// Spoken words arrive a few at a time, many times a second. A tenth of a
// second is about as long as text can trail the voice and still read as live,
// and it holds a surface to ten renders a second however fast the words come.
const INTERIM_WORDS_INTERVAL_MS = 100;

type StoreApi = ReturnType<typeof useStoreApi>;

/** What has been said in a chat's conversation, paced for a surface to show. */
export function useVoiceTranscript(appSessionId: string): VoiceTranscriptLine[] {
  const store = useStoreApi();
  const [lines, setLines] = useState(() => linesOf(store.getState(), appSessionId));
  useEffect(() => followVoiceTranscript(store, appSessionId, setLines), [appSessionId, store]);
  return lines;
}

/**
 * Hands a chat's spoken lines to `show` as they change. More words on a line
 * that is still being spoken wait up to the interval, so a burst of them lands
 * as one update. Anything else is shown at once: a line opening, a line
 * finishing, or a new attempt clearing the feed. Returns the unsubscribe.
 */
export function followVoiceTranscript(
  store: StoreApi,
  appSessionId: string,
  show: (lines: VoiceTranscriptLine[]) => void,
): () => void {
  let shown = linesOf(store.getState(), appSessionId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const showLatest = () => {
    clearTimeout(timer);
    timer = undefined;
    shown = linesOf(store.getState(), appSessionId);
    show(shown);
  };
  // The store can have moved on since the surface first read it.
  show(shown);
  const unsubscribe = store.subscribe(() => {
    const latest = linesOf(store.getState(), appSessionId);
    if (latest === shown) return;
    if (!onlyExtendsOpenLines(shown, latest)) {
      showLatest();
      return;
    }
    timer ??= setTimeout(showLatest, INTERIM_WORDS_INTERVAL_MS);
  });
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}

function linesOf(state: AppState, appSessionId: string): VoiceTranscriptLine[] {
  return voiceSessionOf(state.voiceSessions, appSessionId).lines;
}

/** True when the only change is more words on lines that are still being spoken. */
function onlyExtendsOpenLines(
  shown: VoiceTranscriptLine[],
  latest: VoiceTranscriptLine[],
): boolean {
  if (latest.length !== shown.length) return false;
  return latest.every(
    (line, at) => line === shown[at] || (!line.final && line.id === shown[at].id),
  );
}
