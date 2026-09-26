import { useEffect, useLayoutEffect, useRef } from 'react';
import { shallowEqual, useStoreSelector, type AppState } from '../../hooks/useStore';
import { useVoice, type Voice } from './useVoice';
import { closeVoiceAnalysis } from './voiceAnalysis';

/**
 * The running call: the microphone, the connection to the provider, and where
 * the conversation is shown. VoiceProvider mounts it while a chat owns a
 * conversation, and loads it with the first one rather than with the app.
 *
 * The provider decides which chat that is. The call reports back what it is
 * doing and when it is over, and nothing else writes either.
 */
export function VoiceCall({
  appSessionId,
  opening,
  onScreen,
  onOpened,
  onEnded,
  onChange,
}: {
  appSessionId: string;
  /** A conversation was asked for on this chat and has not started yet. */
  opening: boolean;
  /** The chat is the one on screen. */
  onScreen: boolean;
  onOpened: () => void;
  onEnded: () => void;
  onChange: (voice: Voice | null) => void;
}) {
  const preferences = useStoreSelector(
    (state: AppState) => ({
      voice: state.defaultVoice || undefined,
      narration: state.narrationMode,
    }),
    shallowEqual,
  );
  const voice = useVoice(appSessionId, preferences, onScreen);

  // Opening waits a commit, because the connection can only start once the
  // session hook is bound to the chat it was opened on.
  useEffect(() => {
    if (!opening) return;
    onOpened();
    voice.open();
  }, [onOpened, opening, voice]);

  // The voice and the narration are chosen when a conversation opens, so
  // changing either while one is running reopens it on the new choice. Both
  // the in-call sheet and the Settings panel write the same preferences, and
  // this is the one place that acts on them.
  const running = useRef(voice.restart);
  running.current = voice.restart;
  const held = useRef<typeof preferences | null>(null);
  useEffect(() => {
    const previous = held.current;
    held.current = preferences;
    if (!previous) return;
    if (previous.voice === preferences.voice && previous.narration === preferences.narration)
      return;
    running.current();
  }, [preferences]);

  // The orbs hear the call through one shared audio graph. Once the call holds
  // neither a microphone nor a reply, the graph has nothing left to hear and
  // closes. Moving between surfaces keeps both streams, so it keeps the graph.
  const { micStream, replyStream } = voice.session;
  const hearing = micStream !== null || replyStream !== null;
  useEffect(() => {
    if (!hearing) closeVoiceAnalysis();
  }, [hearing]);

  // Whatever ended the conversation, a hang-up, the provider, or a failed
  // connection, the chat stops owning one.
  useEffect(() => {
    if (opening || voice.view !== 'off') return;
    onEnded();
  }, [onEnded, opening, voice.view]);

  // Chats and surfaces read the call through the provider's context, so every
  // change reaches them before the frame is painted.
  useLayoutEffect(() => {
    onChange(voice);
  }, [onChange, voice]);
  useLayoutEffect(
    () => () => {
      onChange(null);
    },
    [onChange],
  );

  return null;
}
