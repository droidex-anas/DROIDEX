/**
 * One audio graph for every orb on screen.
 *
 * The orb is mounted in more than one place while a conversation moves between
 * the composer and the full surface, and each mount used to build its own
 * `AudioContext` and analyser. Constructing a context costs several
 * milliseconds and happens on exactly the frames the user is watching the view
 * change, which is what made the swap stutter.
 *
 * So the graph is built once per conversation and shared: every orb that hears
 * a stream reads the same analyser. It is closed when the conversation lets go
 * of its audio, because a running context keeps the audio thread working for
 * as long as the app runs, whether or not anything is being said.
 */

let context: AudioContext | null = null;
const taps = new Map<MediaStream, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode }>();

export function analyserFor(stream: MediaStream | null): AnalyserNode | null {
  if (!stream) return null;
  const existing = taps.get(stream);
  if (existing) return existing.analyser;
  try {
    context ??= new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    taps.set(stream, { source, analyser });
    return analyser;
  } catch {
    // No audio output, or a blocked context: the orb breathes instead of
    // reacting, which is the same thing it does in silence.
    return null;
  }
}

/** Lets go of every stream the orbs were hearing, and the context behind them. */
export function closeVoiceAnalysis(): void {
  for (const { source } of taps.values()) source.disconnect();
  taps.clear();
  const closing = context;
  context = null;
  void closing?.close();
}
