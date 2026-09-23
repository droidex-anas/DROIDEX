import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The voice orb: a gradient sphere built from the droid skill/ultra tokens,
 * with two blurred color blobs swirling under the surface. A rAF loop writes
 * transforms straight to the DOM, so 60fps audio reactivity never re-renders
 * React. With neither side speaking it breathes slowly instead of going flat.
 *
 * It hears both ends of the conversation: the microphone while you talk, and
 * the reply while it talks back, so the orb keeps moving with whoever has the
 * floor. The reply also lifts the glow, which is the one visible difference
 * between being listened to and being spoken to.
 */

// Inline rather than utilities: the orb renders only while voice is on, so its
// one-off effects should not ship in every window's stylesheet.
const GLOW_BLOB = { mixBlendMode: 'screen', filter: 'blur(24px)' } as const;
export function VoiceOrb({
  micStream,
  replyStream,
  size = 240,
}: {
  micStream: MediaStream | null;
  replyStream: MediaStream | null;
  size?: number;
}) {
  const blobsRef = useRef<HTMLDivElement>(null);
  const sphereRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const blobs = blobsRef.current;
    const sphere = sphereRef.current;
    const glow = glowRef.current;
    if (reducedMotion || !blobs || !sphere || !glow) return;

    let audio: AudioContext | null = null;
    let samples = new Uint8Array(0);
    const listen = (stream: MediaStream | null): AnalyserNode | null => {
      if (!stream) return null;
      audio ??= new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      if (samples.length === 0) samples = new Uint8Array(analyser.fftSize);
      return analyser;
    };
    const mic = listen(micStream);
    const reply = listen(replyStream);

    const loudness = (analyser: AnalyserNode | null): number => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = sample - 128;
        sum += centered * centered;
      }
      return Math.min(1, (Math.sqrt(sum / samples.length) / 128) * 3.2);
    };

    // VU-meter smoothing: the orb jumps when speech starts and settles slowly,
    // which reads as alive rather than twitchy.
    let level = 0;
    let voice = 0;
    let rotation = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const spoken = loudness(reply);
      const heard = loudness(mic);
      // Breathing only stands in for silence; either side speaking takes over.
      const target = mic || reply ? Math.max(heard, spoken) : 0.12 + 0.07 * Math.sin(now / 900);
      level += (target - level) * (target > level ? 0.45 : 0.07);
      voice += (spoken - voice) * (spoken > voice ? 0.45 : 0.07);
      rotation = (rotation + dt * (10 + level * 140)) % 360;
      sphere.style.transform = `scale(${(1 + level * 0.14).toFixed(4)})`;
      blobs.style.transform = `rotate(${rotation.toFixed(2)}deg) scale(${(1 + level * 0.3).toFixed(4)})`;
      // The orb glows a little further out while it is the one talking.
      glow.style.opacity = (0.5 + level * 0.5).toFixed(3);
      glow.style.transform = `scale(${(1 + voice * 0.12).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (audio) void audio.close();
    };
  }, [micStream, replyStream, reducedMotion]);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        ref={glowRef}
        aria-hidden
        className="absolute rounded-full blur-2xl"
        style={{
          inset: '-14%',
          // The halo is light, not a panel: masking it to a circle keeps its
          // blurred bounding box from reading as a square behind the orb, and
          // it stays faint so the orb reads as a sphere rather than a lamp.
          maskImage: 'radial-gradient(closest-side, #000 55%, transparent 100%)',
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--droid-skill) 32%, transparent), transparent 70%)',
        }}
      />
      <div
        ref={sphereRef}
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          // Blurred, blended children in a rounded overflow box get clipped to
          // the box's rectangle by the compositor, which shows as a square edge
          // around the orb. Clipping to the circle keeps the shape it is drawn as.
          clipPath: 'circle(50% at 50% 50%)',
          // Sky at the top falling into cloud: the orb is lit from inside
          // rather than shaded like a ball, so it keeps one crisp edge and no
          // dark underside.
          background:
            'linear-gradient(170deg, color-mix(in srgb, var(--droid-skill) 82%, #ffffff) 0%, color-mix(in srgb, var(--droid-skill) 34%, #ffffff) 44%, #ffffff 78%, color-mix(in srgb, var(--droid-ultra) 18%, #ffffff) 100%)',
        }}
      >
        <div ref={blobsRef} aria-hidden className="absolute" style={{ inset: '-15%' }}>
          <div
            className="absolute rounded-full"
            style={{
              ...GLOW_BLOB,
              width: '70%',
              height: '62%',
              left: '-8%',
              bottom: '4%',
              background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.9), transparent)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              ...GLOW_BLOB,
              width: '62%',
              height: '55%',
              right: '-10%',
              bottom: '-6%',
              background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.75), transparent)',
            }}
          />
        </div>
        <div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            mixBlendMode: 'screen',
            background:
              'radial-gradient(circle at 38% 70%, rgb(255 255 255 / 0.5), transparent 60%)',
          }}
        />
      </div>
    </div>
  );
}
