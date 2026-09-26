import type { VoiceStatus } from './voiceSessions';

/** What the conversation is doing right now, as the surfaces report it. */
export interface VoiceActivity {
  status: VoiceStatus;
  muted: boolean;
  micDenied: boolean;
  error?: string;
  /** The chat's model is running a turn the conversation asked for. */
  working: boolean;
  /** The assistant's words are still arriving, which is it talking. */
  speaking: boolean;
}

/**
 * The one line every voice surface shows. It says only what the app knows: a
 * failure carries the harness's own words, and each state is claimed only
 * while it is true — starting before the connection exists, speaking while its
 * words are arriving, working while the chat's model runs the turn it was
 * asked for, and listening the rest of the time.
 */
export function voiceStatusLabel(activity: VoiceActivity): string {
  const { status, muted, micDenied, error } = activity;
  if (error) return error;
  if (micDenied) return 'Microphone unavailable';
  if (status === 'connecting') return 'Connecting…';
  if (status !== 'live') return 'Starting voice…';
  if (muted) return 'Muted';
  if (activity.speaking) return 'Speaking…';
  if (activity.working) return 'Working…';
  return 'Listening…';
}

/** True while the line stands for something in progress, which shimmers. */
export function voiceStatusIsLive(activity: VoiceActivity): boolean {
  const { status, muted, micDenied, error } = activity;
  if (error || micDenied || muted) return false;
  return status === 'connecting' || status === 'live';
}
