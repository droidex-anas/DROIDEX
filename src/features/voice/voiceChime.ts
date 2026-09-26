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

/**
 * One note: the pitch, its fifth at a whisper, and a bloom that decays away.
 * Returns the pitch's oscillator, which ends when the note has rung out.
 */
function bloom(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  peak: number,
): OscillatorNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = TONE_HZ;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + RELEASE_S);
  filter.connect(gain).connect(ctx.destination);

  const tone = (ratio: number, level: number): OscillatorNode => {
    const oscillator = ctx.createOscillator();
    const voice = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * ratio;
    voice.gain.value = level;
    oscillator.connect(voice).connect(filter);
    oscillator.start(startAt);
    oscillator.stop(startAt + RELEASE_S + 0.05);
    return oscillator;
  };
  const pitch = tone(1, 1);
  tone(1.5, 0.35);
  return pitch;
}

export function playVoiceChime(chime: Chime): void {
  // Each chime has a context of its own and closes it once it has rung out:
  // an open context keeps the audio thread running for as long as the app
  // does, between conversations as much as during them.
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const close = () => {
    void ctx.close();
  };
  // A context created before any gesture starts suspended; a click is what
  // triggers these, so resuming here is enough. One that cannot resume would
  // never ring out, so it closes now instead.
  void ctx.resume().catch(close);
  const [first, second] = NOTES[chime];
  const now = ctx.currentTime + 0.01;
  bloom(ctx, first, now, PEAK);
  // The second note lands while the first is still ringing, so the pair reads
  // as one gesture instead of two beeps.
  const last = bloom(ctx, second, now + STEP_MS / 1000, chime === 'start' ? PEAK : PEAK * 0.8);
  last.addEventListener('ended', close, { once: true });
}
