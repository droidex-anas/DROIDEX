import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreApi, useStoreSelector, type AppState } from '../../hooks/useStore';
import { useVoice, type Voice } from './useVoice';
import { canUseVoice } from './voiceAvailability';
import { playVoiceChime } from './voiceChime';

export interface VoiceContextValue extends Voice {
  /** The chat the conversation belongs to, or null while none is running. */
  appSessionId: string | null;
  /** True when that chat is the one on screen. */
  onScreen: boolean;
  /** Opens a conversation on a chat, ending one running elsewhere first. */
  openOn: (appSessionId: string) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * The app's one voice conversation.
 *
 * A conversation belongs to the chat it was started on and keeps running while
 * the user reads, or works in, another chat: it is owned here, above the chat
 * view, rather than by the composer that opened it. Only the surfaces move —
 * the chat that owns the conversation shows it over its composer, every other
 * view leaves it minimised.
 *
 * Exactly one conversation exists at a time. Starting another hands the
 * connection to the new chat, which ends the first one cleanly on the way.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const store = useStoreApi();
  // Opening and hanging up are marked by a chime, so the press is answered
  // before the connection can be. Reduced motion keeps it silent.
  const quiet = useReducedMotion() ?? false;
  const activeAppSessionId = useStoreSelector((state: AppState) => state.activeAppSessionId);
  const preferences = useStoreSelector(
    (state: AppState) => ({
      voice: state.defaultVoice || undefined,
      narration: state.narrationMode,
    }),
    shallowEqual,
  );

  // The chat the conversation belongs to, and the chat it has been asked to
  // move to. Opening waits a commit, because the connection can only start once
  // the session hook below is bound to the new chat.
  const [owner, setOwner] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const onScreen = owner !== null && owner === activeAppSessionId;
  const voice = useVoice(owner, preferences, onScreen);

  const openOn = useCallback(
    (appSessionId: string) => {
      const { sessions } = store.getState();
      if (!(appSessionId in sessions) || !canUseVoice(sessions[appSessionId].provider)) return;
      playVoiceChime('start', quiet);
      setOwner(appSessionId);
      setOpening(appSessionId);
    },
    [quiet, store],
  );

  useEffect(() => {
    if (opening === null || opening !== owner) return;
    setOpening(null);
    voice.open();
  }, [opening, owner, voice]);

  const { close } = voice;
  const hangUp = useCallback(() => {
    playVoiceChime('end', quiet);
    close();
  }, [close, quiet]);

  // Whatever ended the conversation — this hang-up, the provider, a failed
  // connection — the chat stops owning one.
  useEffect(() => {
    if (opening !== null || voice.view !== 'off') return;
    setOwner(null);
  }, [opening, voice.view]);

  const value = useMemo<VoiceContextValue>(
    () => ({ ...voice, close: hangUp, appSessionId: owner, onScreen, openOn }),
    [hangUp, onScreen, openOn, owner, voice],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoiceContext(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('Voice is only available inside VoiceProvider.');
  return value;
}
