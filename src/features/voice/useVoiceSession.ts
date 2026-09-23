import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestVoices, startVoice, stopVoice } from '../../lib/commands';
import { useStoreDispatch, useStoreSelector, type AppState } from '../../hooks/useStore';
import type { VoiceNarration } from '../../types/bridge';
import { useMicStream } from './useMicStream';
import { voiceSessionOf, type VoiceStatus, type VoiceTranscriptLine } from './voiceSessions';

/**
 * One voice conversation for one chat.
 *
 * The renderer negotiates WebRTC with the provider's own realtime service and
 * keeps both ends of the audio: the microphone goes out over the peer
 * connection, the provider's reply plays through an audio sink here. Only the
 * handshake travels through the sidecar, so a spoken request lands on the
 * chat's thread as an ordinary turn.
 *
 * The hook owns the attempt. Everything it creates is torn down when the user
 * stops, when the chat changes, when the connection fails, and on unmount.
 */

// Trickle candidates can take a while behind some networks, and the offer is
// good enough without the last of them.
const ICE_GATHERING_TIMEOUT_MS = 3_000;
// Long enough for a cold provider thread, short enough to fail visibly.
const ANSWER_TIMEOUT_MS = 20_000;

/** Everything one negotiation attempt created, so it can all be closed at once. */
interface Negotiation {
  appSessionId: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** True once the offer went out, so stopping tells the provider too. */
  offerSent: boolean;
  cancelled: boolean;
}

export interface VoiceSession {
  status: VoiceStatus;
  /** Why the conversation failed, kept until the next attempt starts. */
  error?: string;
  lines: VoiceTranscriptLine[];
  voices: string[];
  defaultVoice?: string;
  muted: boolean;
  micDenied: boolean;
  /** The live microphone, so a surface can show what it hears. */
  micStream: MediaStream | null;
  /** What the provider is saying, so a surface can show that too. */
  replyStream: MediaStream | null;
  start: () => void;
  stop: () => void;
  toggleMuted: () => void;
  refreshVoices: () => void;
}

export function useVoiceSession(
  appSessionId: string | null,
  voice?: string,
  narration: VoiceNarration = 'brief',
): VoiceSession {
  const dispatch = useStoreDispatch();
  const session = useStoreSelector(
    useCallback(
      (state: AppState) => voiceSessionOf(state.voiceSessions, appSessionId),
      [appSessionId],
    ),
  );
  const [wanted, setWanted] = useState(false);
  const [replyStream, setReplyStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const mic = useMicStream(wanted);
  const negotiationRef = useRef<Negotiation | null>(null);
  const answerRef = useRef<AnswerWaiter | null>(null);

  const teardown = useCallback(() => {
    const waiter = answerRef.current;
    answerRef.current = null;
    waiter?.reject(new Error('The voice session closed before it connected.'));
    const negotiation = negotiationRef.current;
    negotiationRef.current = null;
    if (negotiation) closeNegotiation(negotiation);
  }, []);

  const stop = useCallback(() => {
    const held = negotiationRef.current;
    teardown();
    setReplyStream(null);
    if (held?.offerSent) stopVoice({ appSessionId: held.appSessionId });
    setWanted(false);
    setMuted(false);
    if (appSessionId) dispatch({ type: 'VOICE_ENDED', appSessionId });
  }, [appSessionId, dispatch, teardown]);

  // Handlers that outlive a render (connection failures, the mic verdict) reach
  // the current stop through this rather than through their own dependencies,
  // which would tear a live conversation down on every identity change.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(() => {
    if (!appSessionId || wanted) return;
    setMuted(false);
    setWanted(true);
    dispatch({ type: 'VOICE_CONNECTING', appSessionId });
  }, [appSessionId, dispatch, wanted]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  const refreshVoices = useCallback(() => {
    if (appSessionId) requestVoices({ appSessionId });
  }, [appSessionId]);

  // The answer to the offer this attempt sent. A new attempt clears the stored
  // answer, so the next one to arrive for this chat belongs to it.
  const { answer, error } = session;
  useEffect(() => {
    const waiter = answerRef.current;
    if (!waiter) return;
    if (answer) {
      answerRef.current = null;
      waiter.resolve(answer.sdp);
      return;
    }
    if (error) {
      answerRef.current = null;
      waiter.reject(new Error(error));
    }
  }, [answer, error]);

  // Muting keeps the track on the peer connection; dropping it would end the
  // conversation instead of pausing it.
  useEffect(() => {
    const stream = mic.stream;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
  }, [mic.stream, muted]);

  useEffect(() => {
    if (!wanted || !mic.denied || !appSessionId) return;
    dispatch({
      type: 'VOICE_ERROR',
      appSessionId,
      message: 'DROIDEX could not use the microphone.',
    });
    stopRef.current();
  }, [appSessionId, dispatch, mic.denied, wanted]);

  // The provider hung up: let go of the microphone and the peer connection.
  useEffect(() => {
    if (session.status === 'closed' && wanted) stopRef.current();
  }, [session.status, wanted]);

  useEffect(() => {
    if (!wanted || !appSessionId || negotiationRef.current) return;
    const stream = mic.stream;
    // After a restart the mic hook reports the previous stream for a render;
    // its tracks are already stopped, so wait for the live one.
    if (!stream?.getAudioTracks().some((track) => track.readyState === 'live')) return;

    const negotiation: Negotiation = {
      appSessionId,
      pc: new RTCPeerConnection(),
      audio: new Audio(),
      offerSent: false,
      cancelled: false,
    };
    negotiationRef.current = negotiation;
    const { pc, audio } = negotiation;
    audio.autoplay = true;
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      setReplyStream(stream);
      void audio.play().catch(() => {
        // Autoplay can refuse; the element keeps the track and starts on the
        // next gesture. The conversation itself is unaffected.
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed') return;
      dispatch({ type: 'VOICE_ERROR', appSessionId, message: 'The voice connection dropped.' });
      stopRef.current();
    };

    // True while this attempt is still the one the hook holds. Every await can
    // be outlived by a stop, an unmount, or a chat switch.
    const current = () => negotiationRef.current === negotiation && !negotiation.cancelled;

    const negotiate = async () => {
      pc.createDataChannel('oai-events');
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
      await pc.setLocalDescription(await pc.createOffer());
      await gatherIceCandidates(pc);
      if (!current()) {
        closeNegotiation(negotiation);
        return;
      }
      const offer = pc.localDescription?.sdp;
      if (!offer) throw new Error('The browser produced no voice offer.');
      negotiation.offerSent = true;
      startVoice({ appSessionId, sdp: offer, voice, narration });
      const sdp = await waitForAnswer(answerRef);
      if (!current()) {
        closeNegotiation(negotiation);
        return;
      }
      await pc.setRemoteDescription({ type: 'answer', sdp });
      if (!current()) closeNegotiation(negotiation);
    };

    negotiate().catch((cause: unknown) => {
      if (!current()) return;
      dispatch({ type: 'VOICE_ERROR', appSessionId, message: messageOf(cause) });
      stopRef.current();
    });
  }, [appSessionId, dispatch, mic.stream, narration, voice, wanted]);

  // A chat switch or an unmount ends the conversation; nothing else runs this,
  // so a live attempt survives unrelated re-renders.
  useEffect(() => {
    return () => {
      const held = negotiationRef.current;
      teardown();
      if (held?.offerSent) stopVoice({ appSessionId: held.appSessionId });
      setWanted(false);
      setMuted(false);
      if (appSessionId) dispatch({ type: 'VOICE_ENDED', appSessionId });
    };
  }, [appSessionId, dispatch, teardown]);

  return useMemo(
    () => ({
      status: session.status,
      error: session.error,
      lines: session.lines,
      voices: session.voices,
      defaultVoice: session.defaultVoice,
      muted,
      micDenied: mic.denied,
      micStream: mic.stream,
      replyStream,
      start,
      stop,
      toggleMuted,
      refreshVoices,
    }),
    [mic.denied, mic.stream, muted, refreshVoices, replyStream, session, start, stop, toggleMuted],
  );
}

interface AnswerWaiter {
  resolve: (sdp: string) => void;
  reject: (error: Error) => void;
}

function waitForAnswer(ref: { current: AnswerWaiter | null }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      ref.current = null;
      reject(new Error('The voice session did not answer in time.'));
    }, ANSWER_TIMEOUT_MS);
    ref.current = {
      resolve: (sdp) => {
        globalThis.clearTimeout(timer);
        resolve(sdp);
      },
      reject: (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    };
  });
}

function gatherIceCandidates(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const finish = () => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      globalThis.clearTimeout(timer);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    const timer = globalThis.setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
  });
}

function closeNegotiation(negotiation: Negotiation): void {
  negotiation.cancelled = true;
  const { pc, audio } = negotiation;
  pc.onconnectionstatechange = null;
  pc.ontrack = null;
  pc.close();
  audio.pause();
  audio.srcObject = null;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : 'The voice session failed.';
}
