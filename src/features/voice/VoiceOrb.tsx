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
          inset: '-22%',
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--droid-skill) 55%, transparent), color-mix(in srgb, var(--droid-ultra) 30%, transparent) 55%, transparent 75%)',
        }}
      />
      <div
        ref={sphereRef}
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          background:
            'linear-gradient(145deg, #ffffff 0%, var(--droid-skill) 38%, var(--droid-ultra) 68%, color-mix(in srgb, var(--droid-ultra) 45%, #000000) 100%)',
          boxShadow:
            'inset -14px -20px 40px rgb(24 16 68 / 0.4), inset 6px 8px 24px rgb(255 255 255 / 0.35), 0 24px 70px -18px color-mix(in srgb, var(--droid-ultra) 55%, transparent)',
        }}
      >
        <div ref={blobsRef} aria-hidden className="absolute" style={{ inset: '-15%' }}>
          <div
            className="absolute rounded-full"
            style={{
              ...GLOW_BLOB,
              width: '55%',
              height: '55%',
              left: '-4%',
              top: '8%',
              background:
                'radial-gradient(closest-side, color-mix(in srgb, var(--droid-skill) 60%, transparent), transparent)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              ...GLOW_BLOB,
              width: '60%',
              height: '60%',
              right: '-6%',
              bottom: '2%',
              background:
                'radial-gradient(closest-side, color-mix(in srgb, var(--droid-ultra) 60%, transparent), transparent)',
            }}
          />
        </div>
        <div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            mixBlendMode: 'screen',
            background:
              'radial-gradient(circle at 32% 26%, rgb(255 255 255 / 0.85), transparent 45%)',
          }}
        />
      </div>
    </div>
  );
}
