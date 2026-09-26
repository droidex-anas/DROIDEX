/**
 * One audio graph for every orb on screen.
 *
 * The orb is mounted in more than one place while a conversation moves between
 * the composer and the full surface, and each mount used to build its own
 * `AudioContext` and analyser. Constructing a context costs several
 * milliseconds and happens on exactly the frames the user is watching the view
 * change, which is what made the swap stutter.
 *
 * The context is made once and kept: an idle one is cheap, and the alternative
 * is paying for it again the next time someone speaks. Analysers are held
 * weakly against their stream, so they are collected with the conversation that
 * owned them rather than accumulating.
 */

let context: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode>();

export function analyserFor(stream: MediaStream | null): AnalyserNode | null {
  if (!stream) return null;
  const existing = analysers.get(stream);
  if (existing) return existing;
  try {
    context ??= new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    analysers.set(stream, analyser);
    return analyser;
  } catch {
    // No audio output, or a blocked context: the orb breathes instead of
    // reacting, which is the same thing it does in silence.
    return null;
  }
}
