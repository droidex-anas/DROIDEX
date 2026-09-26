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
import { useStoreApi, useStoreSelector, type AppState } from '../../hooks/useStore';
import { renameSession } from '../../lib/commands';
import type { Voice } from './useVoice';
import { canUseVoice } from './voiceAvailability';
import { voiceSessionOf } from './voiceSessions';

// The chimes are heard when a conversation opens and when it ends, so they are
// fetched with the first one rather than with the app. Sticky user activation
// outlives the import, so the sound still plays from the click that asked for
// it.
function playVoiceChime(chime: 'start' | 'end'): void {
  void import('./voiceChime').then((m) => {
    m.playVoiceChime(chime);
  });
}

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

// The call itself, the microphone and the connection to the provider, is only
// needed once someone talks, so it loads with the first conversation too.
const VoiceCall = lazy(() => import('./VoiceCall').then((m) => ({ default: m.VoiceCall })));

/**
 * What a chat needs to know about the conversation: whether one is running,
 * where it is shown, and how to start or end it. Deliberately without the
 * transcript, which changes with every spoken word: the composer reads this,
 * and re-rendering it per word would put voice on the app's hot path.
 */
export interface VoiceControls {
  view: Voice['view'];
  working: boolean;
  /** The chat the conversation belongs to, or null while none is running. */
  appSessionId: string | null;
  /** True when that chat is the one on screen. */
  onScreen: boolean;
  /**
   * Opens a conversation on a chat, ending one running elsewhere first.
   * `nameFromSpeech` is for a chat the orb just created, which has no prompt
   * to take a name from and takes one from the first thing said in it.
   */
  openOn: (appSessionId: string, options?: { nameFromSpeech?: boolean }) => void;
  close: () => void;
}

const VoiceControlsContext = createContext<VoiceControls | null>(null);
// The conversation itself, for the surfaces that show what is being said. Null
// while none is running.
const VoiceConversationContext = createContext<Voice | null>(null);

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
 *
 * The call that carries the conversation is VoiceCall, mounted while a chat
 * owns one. This provider decides which chat that is and hands what the call
 * reports to the chat and the surfaces.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const store = useStoreApi();
  // Opening and hanging up are marked by a chime, so the press is answered
  // before the connection can be.
  const activeAppSessionId = useStoreSelector((state: AppState) => state.activeAppSessionId);
  // Pull requests, automations and settings are not the chat, so a conversation
  // held there is held away from its chat and wears the mini bar.
  const mainView = useStoreSelector((state: AppState) => state.mainView);

  // The chat the conversation belongs to, and whether it has been asked to open
  // there and not started yet.
  const [owner, setOwner] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  // The call as it last reported itself, or null while none is running.
  const [call, setCall] = useState<Voice | null>(null);

  const onScreen = owner !== null && owner === activeAppSessionId && mainView === 'session';

  // The chats the orb created, which are the only ones a conversation renames.
  const unnamed = useRef(new Set<string>());

  const openOn = useCallback(
    (appSessionId: string, options?: { nameFromSpeech?: boolean }) => {
      const { sessions } = store.getState();
      if (!(appSessionId in sessions) || !canUseVoice(sessions[appSessionId].provider)) return;
      if (options?.nameFromSpeech) unnamed.current.add(appSessionId);
      playVoiceChime('start');
      setOwner(appSessionId);
      setOpening(true);
    },
    [store],
  );
  const opened = useCallback(() => {
    setOpening(false);
  }, []);
  const ended = useCallback(() => {
    setOwner(null);
  }, []);

  // A chat the orb created has no prompt to take its name from, so it wears a
  // placeholder until the first thing said in it, and takes its name from that.
  // A chat that already has a name keeps it.
  const firstRequest = useStoreSelector(
    useCallback(
      (state: AppState) =>
        voiceSessionOf(state.voiceSessions, owner).lines.find(
          (line) => line.role === 'user' && line.final,
        )?.text,
      [owner],
    ),
  );
  useEffect(() => {
    if (owner === null || !firstRequest || !unnamed.current.has(owner)) return;
    const title = firstRequest.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!title) return;
    unnamed.current.delete(owner);
    renameSession(owner, title);
  }, [firstRequest, owner]);

  const close = call?.close;
  const hangUp = useCallback(() => {
    playVoiceChime('end');
    close?.();
  }, [close]);

  const conversation = useMemo(() => (call ? { ...call, close: hangUp } : null), [call, hangUp]);
  // Keyed on the few things that change when the call does, not on the words
  // being said, so a chat only re-renders when the conversation itself moves.
  const view = call?.view ?? 'off';
  const working = call?.working ?? false;
  const controls = useMemo<VoiceControls>(
    () => ({
      view,
      working,
      appSessionId: owner,
      onScreen,
      openOn,
      close: hangUp,
    }),
    [hangUp, onScreen, openOn, owner, view, working],
  );

  return (
    <VoiceControlsContext.Provider value={controls}>
      <VoiceConversationContext.Provider value={conversation}>
        {children}
        {owner !== null && (
          <Suspense fallback={null}>
            <VoiceCall
              appSessionId={owner}
              opening={opening}
              onScreen={onScreen}
              onOpened={opened}
              onEnded={ended}
              onChange={setCall}
            />
          </Suspense>
        )}
        <AnimatePresence>
          {conversation?.view === 'full' && owner !== null && (
            <Suspense fallback={null}>
              <VoiceSurface key="voice-surface" voice={conversation} appSessionId={owner} />
            </Suspense>
          )}
          {conversation?.view === 'mini' && owner !== null && (
            <Suspense fallback={null}>
              <VoiceMiniBar key="voice-mini" voice={conversation} appSessionId={owner} />
            </Suspense>
          )}
        </AnimatePresence>
      </VoiceConversationContext.Provider>
    </VoiceControlsContext.Provider>
  );
}

/** For a chat: whether a conversation is running, and how to start or end one. */
export function useVoiceControls(): VoiceControls {
  const value = useContext(VoiceControlsContext);
  if (!value) throw new Error('Voice is only available inside VoiceProvider.');
  return value;
}

/** For a surface that shows the conversation: the live session behind it. */
export function useVoiceConversation(): Voice {
  const value = useContext(VoiceConversationContext);
  if (!value) throw new Error('A voice surface needs a running conversation.');
  return value;
}
