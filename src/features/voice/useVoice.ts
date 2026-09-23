import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderKind, VoiceNarration } from '../../types/bridge';
import { canUseVoice } from './voiceAvailability';
import { useVoiceSession, type VoiceSession } from './useVoiceSession';

/** Where the conversation is shown: nowhere, the full window, or over the composer. */
export type VoiceView = 'off' | 'full' | 'dock';

export interface Voice {
  /** True where the chat's harness can hold a conversation at all. */
  available: boolean;
  view: VoiceView;
  session: VoiceSession;
  /** Opens the full surface and connects. */
  open: () => void;
  /** Keeps talking with the chat in view. */
  minimize: () => void;
  expand: () => void;
  close: () => void;
}

/**
 * Voice for the chat the composer is pointing at: the connection plus the two
 * surfaces it can wear. The view follows the conversation — it opens full, and
 * it closes itself when the conversation ends for any reason, including a
 * failure — so no surface is left hanging over a chat that is not talking.
 *
 * The voice itself is chosen when a conversation opens, so changing it while
 * one is running reconnects: the surface stays, and the new voice takes over.
 */
export function useVoice(
  appSessionId: string | null,
  provider: ProviderKind | null | undefined,
  preferences: { voice?: string; narration: VoiceNarration },
): Voice {
  const session = useVoiceSession(appSessionId, preferences.voice, preferences.narration);
  const [view, setView] = useState<VoiceView>('off');
  const [reconnecting, setReconnecting] = useState(false);
  const { status, start, stop } = session;

  const open = useCallback(() => {
    setView('full');
    start();
  }, [start]);

  const close = useCallback(() => {
    setReconnecting(false);
    setView('off');
    stop();
  }, [stop]);

  const minimize = useCallback(() => {
    setView((current) => (current === 'off' ? current : 'dock'));
  }, []);

  const expand = useCallback(() => {
    setView((current) => (current === 'off' ? current : 'full'));
  }, []);

  // A conversation that ends on its own (the provider closed it, the mic was
  // refused, the chat was switched) takes its surface with it. A reconnect
  // passes through the same idle state and keeps the surface.
  useEffect(() => {
    if (reconnecting) return;
    if (status === 'idle' || status === 'closed') setView('off');
  }, [reconnecting, status]);

  // Switching voices: end the conversation, then open the next one on the
  // voice now chosen. Only a running conversation reconnects; a change made
  // while voice is off simply applies the next time it starts.
  const openedWith = useRef(preferences.voice);
  useEffect(() => {
    if (status !== 'live') {
      if (status === 'idle' && !reconnecting) openedWith.current = preferences.voice;
      return;
    }
    if (openedWith.current === preferences.voice) return;
    openedWith.current = preferences.voice;
    setReconnecting(true);
    stop();
  }, [preferences.voice, reconnecting, status, stop]);

  useEffect(() => {
    if (!reconnecting || status !== 'idle') return;
    setReconnecting(false);
    start();
  }, [reconnecting, start, status]);

  // The voices are per harness, and the list only answers once a chat is live.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!appSessionId || view === 'off' || asked.current === appSessionId) return;
    asked.current = appSessionId;
    session.refreshVoices();
  }, [appSessionId, session, view]);

  return { available: canUseVoice(provider), view, session, open, minimize, expand, close };
}
