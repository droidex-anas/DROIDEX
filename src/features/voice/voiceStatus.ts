import type { VoiceStatus } from './voiceSessions';

/**
 * The one line every voice surface shows. It says only what the app knows: a
 * failure carries the harness's own words, "listening" is claimed only once
 * the conversation is actually open, and the moment before that says the
 * conversation is starting rather than pretending it has.
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
  // These surfaces only exist while a conversation is being held, so an idle
  // status here is the moment between the click and the connection.
  return 'Starting voice…';
}
