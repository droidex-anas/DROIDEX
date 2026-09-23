// What the renderer knows about a voice conversation while it runs, keyed by
// the chat holding it. All of it is ephemeral: the conversation itself does not
// survive a reload, so neither does this.
//
// The reducer lives here rather than in the store so the transitions stay
// readable next to the hook that drives them; the store owns the slice and
// delegates, the way it does for the pull-request inbox.

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'closed';

export type VoiceRole = 'user' | 'assistant';

export interface VoiceTranscriptLine {
  id: number;
  role: VoiceRole;
  text: string;
  /** False while the speaker is still talking and deltas keep extending it. */
  final: boolean;
}

export interface VoiceSessionState {
  status: VoiceStatus;
  /** Why the attempt failed; kept past the end so a surface can explain it. */
  error?: string;
  /** Why the provider closed the conversation. */
  reason?: string;
  voices: string[];
  defaultVoice?: string;
  /**
   * The provider's SDP answer to the offer the current attempt sent. A new
   * attempt clears it, so whoever is waiting can take the next one it sees as
   * its own; the wrapper object makes each answer a distinct value.
   */
  answer?: { sdp: string };
  lines: VoiceTranscriptLine[];
}

export type VoiceSessions = Record<string, VoiceSessionState>;

export interface VoiceSlice {
  voiceSessions: VoiceSessions;
}

export type VoiceAction =
  | { type: 'VOICE_CONNECTING'; appSessionId: string }
  | { type: 'VOICE_ANSWERED'; appSessionId: string; sdp: string }
  | { type: 'VOICE_STATE'; appSessionId: string; status: 'live' | 'closed'; reason?: string }
  | {
      type: 'VOICE_TRANSCRIPT';
      appSessionId: string;
      role: VoiceRole;
      text: string;
      final: boolean;
    }
  | { type: 'VOICE_VOICES'; appSessionId: string; voices: string[]; defaultVoice?: string }
  | { type: 'VOICE_ERROR'; appSessionId: string; message: string }
  // The renderer no longer holds a conversation, whether it stopped, failed, or
  // never connected.
  | { type: 'VOICE_ENDED'; appSessionId: string };

// A spoken exchange is short, but nothing bounds it; keep the tail a surface
// would actually show.
const MAX_LINES = 200;

const IDLE: VoiceSessionState = { status: 'idle', voices: [], lines: [] };

/** The chat's voice state, or the shared idle one when it has never spoken. */
export function voiceSessionOf(
  sessions: VoiceSessions,
  appSessionId: string | null,
): VoiceSessionState {
  if (!appSessionId) return IDLE;
  return sessions[appSessionId] ?? IDLE;
}

export function withoutVoiceSession(sessions: VoiceSessions, appSessionId: string): VoiceSessions {
  if (!(appSessionId in sessions)) return sessions;
  return Object.fromEntries(Object.entries(sessions).filter(([id]) => id !== appSessionId));
}

export function reduceVoice<S extends VoiceSlice>(state: S, action: VoiceAction): S {
  const current = state.voiceSessions[action.appSessionId] ?? IDLE;
  const next = nextSession(current, action);
  if (next === current) return state;
  return {
    ...state,
    voiceSessions: { ...state.voiceSessions, [action.appSessionId]: next },
  };
}

function nextSession(current: VoiceSessionState, action: VoiceAction): VoiceSessionState {
  switch (action.type) {
    case 'VOICE_CONNECTING':
      // A fresh attempt keeps only the voices already listed for this chat.
      return {
        status: 'connecting',
        voices: current.voices,
        defaultVoice: current.defaultVoice,
        lines: [],
      };
    case 'VOICE_ANSWERED':
      return { ...current, answer: { sdp: action.sdp } };
    case 'VOICE_STATE':
      return {
        ...current,
        status: action.status,
        reason: action.status === 'closed' ? action.reason : undefined,
      };
    case 'VOICE_TRANSCRIPT': {
      const lines = withTranscript(current.lines, action.role, action.text, action.final);
      return lines === current.lines ? current : { ...current, lines };
    }
    case 'VOICE_VOICES':
      return { ...current, voices: action.voices, defaultVoice: action.defaultVoice };
    case 'VOICE_ERROR':
      return { ...current, error: action.message };
    case 'VOICE_ENDED':
      if (current.status === 'idle' && !current.answer && current.lines.length === 0)
        return current;
      return {
        status: 'idle',
        error: current.error,
        voices: current.voices,
        defaultVoice: current.defaultVoice,
        lines: [],
      };
  }
}

function withTranscript(
  lines: VoiceTranscriptLine[],
  role: VoiceRole,
  text: string,
  final: boolean,
): VoiceTranscriptLine[] {
  const open = lines.length > 0 ? lines[lines.length - 1] : undefined;
  if (open && !open.final && open.role === role) {
    // Deltas extend the line being spoken. The closing notification carries the
    // whole utterance, so it replaces what was accumulated.
    return [
      ...lines.slice(0, -1),
      { ...open, text: final ? text || open.text : open.text + text, final },
    ];
  }
  if (!text) return lines;
  const id = (open?.id ?? 0) + 1;
  return [...lines, { id, role, text, final }].slice(-MAX_LINES);
}
