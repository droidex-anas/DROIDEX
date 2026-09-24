import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceNarration } from '../../types/bridge';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useVoiceSession, type VoiceSession } from './useVoiceSession';
import type { VoiceActivity } from './voiceStatus';

/**
 * Where the conversation is shown: nowhere, the full window, over the composer
 * of the chat it belongs to, or out of the way while another chat is read.
 */
type VoiceView = 'off' | 'full' | 'dock' | 'mini';

/** Where the conversation puts itself. `mini` is this plus the chat on screen. */
type VoicePlacement = 'off' | 'full' | 'dock';

export interface Voice {
  /** The chat's model is running a turn this conversation asked for. */
  working: boolean;
  /** What the conversation is doing, for the line every surface shows. */
  activity: VoiceActivity;
  view: VoiceView;
  session: VoiceSession;
  /** Opens the full surface and connects. */
  open: () => void;
  /** Keeps talking with the chat in view. */
  minimize: () => void;
  expand: () => void;
  close: () => void;
  /** Reopens the conversation, which is how a new voice takes over. */
  restart: () => void;
}

/**
 * One voice conversation and the surfaces it can wear: the connection for the
 * chat that started it, plus where that conversation is currently shown. The
 * view follows the conversation — it opens full, and it closes itself when the
 * conversation ends for any reason, including a failure — so no surface is left
 * hanging over a chat that is not talking.
 *
 * Reading another chat does not end anything: the conversation keeps running
 * and its view reads `mini` until the chat it belongs to is back on screen.
 *
 * The voice itself is chosen when a conversation opens, so changing it while
 * one is running reconnects: the surface stays, and the new voice takes over.
 */
export function useVoice(
  appSessionId: string | null,
  preferences: { voice?: string; narration: VoiceNarration },
  onScreen: boolean,
): Voice {
  const session = useVoiceSession(appSessionId, preferences.voice, preferences.narration);
  // A spoken request runs as an ordinary turn on the chat, so the chat's own
  // live state is what "working" means here.
  const working = useSessionLive(appSessionId);
  const [placement, setPlacement] = useState<VoicePlacement>('off');
  const [reconnecting, setReconnecting] = useState(false);
  const { status, start, stop } = session;

  const open = useCallback(() => {
    setPlacement('full');
    start();
  }, [start]);

  const close = useCallback(() => {
    setReconnecting(false);
    setPlacement('off');
    stop();
  }, [stop]);

  const minimize = useCallback(() => {
    setPlacement((current) => (current === 'off' ? current : 'dock'));
  }, []);

  const expand = useCallback(() => {
    setPlacement((current) => (current === 'off' ? current : 'full'));
  }, []);

  // A voice is chosen when a conversation opens, so taking a new one means
  // opening a new conversation. The surface stays up across the swap.
  const restart = useCallback(() => {
    if (status !== 'live' && status !== 'connecting') return;
    setReconnecting(true);
    stop();
  }, [status, stop]);

  // A conversation that ends on its own (the provider closed it, the mic was
  // refused) takes its surface with it. A reconnect passes through the same
  // idle state and keeps the surface.
  useEffect(() => {
    if (reconnecting) return;
    if (status === 'idle' || status === 'closed') setPlacement('off');
  }, [reconnecting, status]);

  useEffect(() => {
    if (!reconnecting || status !== 'idle') return;
    setReconnecting(false);
    start();
  }, [reconnecting, start, status]);

  // The voices are per harness, and the list only answers once a chat is live.
  // Asked once per conversation rather than once per chat: what the renderer
  // knows about a chat's voice does not outlive a closed runtime, so a later
  // conversation would otherwise be left with an empty list.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!appSessionId || placement === 'off') {
      asked.current = null;
      return;
    }
    if (asked.current === appSessionId) return;
    asked.current = appSessionId;
    session.refreshVoices();
  }, [appSessionId, placement, session]);

  return {
    view: placement === 'dock' && !onScreen ? 'mini' : placement,
    session,
    working,
    activity: { ...session, working },
    open,
    minimize,
    expand,
    close,
    restart,
  };
}
