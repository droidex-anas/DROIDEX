import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import { shallowEqual, useStoreApi, useStoreSelector, type AppState } from '../../hooks/useStore';
import { renameSession } from '../../lib/commands';
import { useVoice, type Voice } from './useVoice';
import { canUseVoice } from './voiceAvailability';
import { playVoiceChime } from './voiceChime';

// The bar only exists while a conversation is held away from its chat, so it
// loads then rather than sitting in every window's first bundle.
const VoiceMiniBar = lazy(() =>
  import('./VoiceMiniBar').then((m) => ({ default: m.VoiceMiniBar })),
);

// The full surface belongs to the conversation rather than to the composer that
// opened it, so it stays up while the user moves around the app.
const VoiceSurface = lazy(() =>
  import('./VoiceSurface').then((m) => ({ default: m.VoiceSurface })),
);

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
 *
 * The mini bar is mounted here too: it belongs to the conversation rather than
 * to any one screen, so it stays in front of settings, automations and every
 * other view the user leaves the chat for.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const store = useStoreApi();
  // Opening and hanging up are marked by a chime, so the press is answered
  // before the connection can be.
  const activeAppSessionId = useStoreSelector((state: AppState) => state.activeAppSessionId);
  // Pull requests, automations and settings are not the chat, so a conversation
  // held there is held away from its chat and wears the mini bar.
  const mainView = useStoreSelector((state: AppState) => state.mainView);
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

  const onScreen = owner !== null && owner === activeAppSessionId && mainView === 'session';
  const voice = useVoice(owner, preferences, onScreen);

  const openOn = useCallback(
    (appSessionId: string) => {
      const { sessions } = store.getState();
      if (!(appSessionId in sessions) || !canUseVoice(sessions[appSessionId].provider)) return;
      playVoiceChime('start');
      setOwner(appSessionId);
      setOpening(appSessionId);
    },
    [store],
  );

  useEffect(() => {
    if (opening === null || opening !== owner) return;
    setOpening(null);
    voice.open();
  }, [opening, owner, voice]);

  // A chat opened by voice has no prompt to take its name from, so it wears a
  // placeholder until the first thing said in it, and takes its name from that.
  const named = useRef<string | null>(null);
  const firstRequest = voice.session.lines.find((line) => line.role === 'user' && line.final);
  useEffect(() => {
    if (owner === null || !firstRequest || named.current === owner) return;
    named.current = owner;
    const title = firstRequest.text.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (title) renameSession(owner, title);
  }, [firstRequest, owner]);

  const { close } = voice;
  const hangUp = useCallback(() => {
    playVoiceChime('end');
    close();
  }, [close]);

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

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {value.view === 'full' && (
          <Suspense fallback={null}>
            <VoiceSurface key="voice-surface" voice={value} />
          </Suspense>
        )}
        {value.view === 'mini' && owner !== null && (
          <Suspense fallback={null}>
            <VoiceMiniBar key="voice-mini" voice={value} appSessionId={owner} />
          </Suspense>
        )}
      </AnimatePresence>
    </VoiceContext.Provider>
  );
}

export function useVoiceContext(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('Voice is only available inside VoiceProvider.');
  return value;
}
