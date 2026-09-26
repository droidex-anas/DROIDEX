// What the renderer knows about a voice conversation while it runs, keyed by
// the chat holding it. All of it is ephemeral: the conversation itself does not
// survive a reload, so neither does this.
//
// The reducer lives here rather than in the store so the transitions stay
// readable next to the hook that drives them; the store owns the slice and
// delegates, the way it does for the pull-request inbox.
//
// Finished utterances arrive separately as durable chat rows from the sidecar.

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'closed';

export type VoiceRole = 'user' | 'assistant';

export interface VoiceTranscriptLine {
  /** Unique within its chat for as long as the app runs, across attempts. */
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
  voices: string[];
  defaultVoice?: string;
  /**
   * The provider's SDP answer to the offer the current attempt sent. A new
   * attempt clears it, so whoever is waiting can take the next one it sees as
   * its own; the wrapper object makes each answer a distinct value.
   */
  answer?: { sdp: string; attempt: string };
  lines: VoiceTranscriptLine[];
  /** How many lines this chat has ever opened. */
  linesOpened: number;
}

export type VoiceSessions = Record<string, VoiceSessionState>;

export interface VoiceSlice {
  voiceSessions: VoiceSessions;
}

export type VoiceAction =
  | { type: 'VOICE_CONNECTING'; appSessionId: string }
  | { type: 'VOICE_ANSWERED'; appSessionId: string; sdp: string; attempt: string }
  | { type: 'VOICE_STATE'; appSessionId: string; status: 'live' | 'closed' }
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

const IDLE: VoiceSessionState = {
  status: 'idle',
  voices: [],
  lines: [],
  linesOpened: 0,
};

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
        linesOpened: current.linesOpened,
      };
    case 'VOICE_ANSWERED':
      return { ...current, answer: { sdp: action.sdp, attempt: action.attempt } };
    case 'VOICE_STATE':
      // Connecting clears what went wrong on the way: a chat whose runtime had
      // to be resumed refuses the first request and answers the second.
      return action.status === 'live'
        ? { ...current, status: action.status, error: undefined }
        : { ...current, status: action.status };
    case 'VOICE_TRANSCRIPT':
      return withSpokenText(current, action.role, action.text, action.final);
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
        linesOpened: current.linesOpened,
      };
  }
}

function withSpokenText(
  current: VoiceSessionState,
  role: VoiceRole,
  text: string,
  final: boolean,
): VoiceSessionState {
  const lines = current.lines;
  // Both sides can be mid-sentence at once: what the user is saying is
  // transcribed while the assistant is still talking. Each side extends its
  // own open line, wherever that line ended up.
  const openAt = lines.findLastIndex((line) => !line.final && line.role === role);
  const open = lines.at(-1);
  if (openAt >= 0) {
    const speaking = lines[openAt];
    // Deltas extend the line being spoken. The closing notification carries the
    // whole utterance, so it replaces what was accumulated.
    const spoken = {
      ...speaking,
      text: final ? text || speaking.text : speaking.text + text,
      final,
    };
    return { ...current, lines: lines.with(openAt, spoken) };
  }
  // The provider closes an utterance more than once, and it closes a short
  // reply before continuing it. Both arrive right after the line they belong
  // to, so only that line is extended — anything further back stays as it was
  // said, and a later line never rewrites an earlier one.
  if (final && text && open?.final && open.role === role) {
    if (open.text === text) return current;
    if (text.startsWith(open.text)) {
      return { ...current, lines: [...lines.slice(0, -1), { ...open, text }] };
    }
  }
  if (!text) return current;
  const id = current.linesOpened + 1;
  return {
    ...current,
    lines: [...lines, { id, role, text, final }].slice(-MAX_LINES),
    linesOpened: id,
  };
}
