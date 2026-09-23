import type { VoiceStatus } from './voiceSessions';

/**
 * The one line both voice surfaces show. It says only what the app knows: a
 * failure carries the harness's own words, and "listening" is claimed only
 * once the conversation is actually open.
 */
export function voiceStatusLabel(
  status: VoiceStatus,
  muted: boolean,
  micDenied: boolean,
  error?: string,
): string {
  if (error) return error;
  if (micDenied) return 'Microphone unavailable';
  if (status === 'connecting') return 'Connecting…';
  if (status === 'live') return muted ? 'Muted' : 'Listening — just talk';
  return 'Voice is off';
}
