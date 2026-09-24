/**
 * The two sounds a voice conversation makes: one when it opens, one when it
 * ends. They are short, quiet and synthesised here rather than shipped as
 * files, so the app carries no audio assets and the cue costs nothing until it
 * plays. The pair is deliberately mirrored — opening rises, ending falls — so
 * the ear knows which happened without looking.
 *
 * A device with no audio output, a blocked AudioContext, or a user who asked
 * for less motion gets silence instead of an error.
 */

type Chime = 'start' | 'end';

// A soft two-note figure. Rising to open, the same notes falling to close.
const NOTES: Record<Chime, [number, number]> = {
  start: [587.33, 880],
  end: [880, 587.33],
};

const NOTE_MS = 110;
const GAIN = 0.05;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  return context;
}

function tone(ctx: AudioContext, frequency: number, startAt: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  // A flat envelope clicks; this opens and closes the note instead.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(GAIN, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + NOTE_MS / 1000);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + NOTE_MS / 1000 + 0.02);
}

export function playVoiceChime(chime: Chime, reducedMotion = false): void {
  if (reducedMotion) return;
  const ctx = audioContext();
  if (!ctx) return;
  // A context created before any gesture starts suspended; a click is what
  // triggers these, so resuming here is enough.
  void ctx.resume().catch(() => undefined);
  const [first, second] = NOTES[chime];
  const now = ctx.currentTime;
  tone(ctx, first, now);
  tone(ctx, second, now + NOTE_MS / 1000);
}
