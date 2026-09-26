/**
 * The two sounds a voice conversation makes: one when it opens, one when it
 * ends. They are synthesised here rather than shipped as files, so the app
 * carries no audio assets and the cue costs nothing until it plays.
 *
 * Both are the same soft bloom — a note with its fifth above it, warmed by a
 * low-pass and a slow release so it blooms rather than beeps. Opening rises,
 * ending falls, so the ear knows which happened without looking. A device with
 * no audio output or a blocked AudioContext gets silence instead of an error.
 * Reduced motion does not silence these: they are the sound of an audio feature
 * starting and stopping, not decoration.
 */

type Chime = 'start' | 'end';

// A fourth apart, the interval a call uses to say connected or hung up.
const NOTES: Record<Chime, [number, number]> = {
  start: [698.46, 1046.5],
  end: [1046.5, 698.46],
};

const STEP_MS = 120;
const RELEASE_S = 0.5;
const PEAK = 0.06;
// Takes the edge off the harmonics so the note reads as soft rather than
// electronic.
const TONE_HZ = 2600;

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

/** One note: the pitch, its fifth at a whisper, and a bloom that decays away. */
function bloom(ctx: AudioContext, frequency: number, startAt: number, peak: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = TONE_HZ;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + RELEASE_S);
  filter.connect(gain).connect(ctx.destination);

  for (const [ratio, level] of [
    [1, 1],
    [1.5, 0.35],
  ] as const) {
    const oscillator = ctx.createOscillator();
    const voice = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * ratio;
    voice.gain.value = level;
    oscillator.connect(voice).connect(filter);
    oscillator.start(startAt);
    oscillator.stop(startAt + RELEASE_S + 0.05);
  }
}

export function playVoiceChime(chime: Chime): void {
  const ctx = audioContext();
  if (!ctx) return;
  // A context created before any gesture starts suspended; a click is what
  // triggers these, so resuming here is enough.
  void ctx.resume().catch(() => undefined);
  const [first, second] = NOTES[chime];
  const now = ctx.currentTime + 0.01;
  bloom(ctx, first, now, PEAK);
  // The second note lands while the first is still ringing, so the pair reads
  // as one gesture instead of two beeps.
  bloom(ctx, second, now + STEP_MS / 1000, chime === 'start' ? PEAK : PEAK * 0.8);
}
