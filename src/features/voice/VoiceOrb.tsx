import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The voice orb: a gradient sphere built from the droid skill/ultra tokens,
 * with two blurred color blobs swirling under the surface. A rAF loop writes
 * transforms straight to the DOM, so 60fps audio reactivity never re-renders
 * React. Without a mic stream it breathes slowly instead of going flat.
 */
export function VoiceOrb({ stream, size = 240 }: { stream: MediaStream | null; size?: number }) {
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
    let analyser: AnalyserNode | null = null;
    let samples = new Uint8Array(0);
    if (stream) {
      audio = new AudioContext();
      const source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      samples = new Uint8Array(analyser.fftSize);
    }

    // VU-meter smoothing: the orb jumps when speech starts and settles slowly,
    // which reads as alive rather than twitchy.
    let level = 0;
    let rotation = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let target = 0.12 + 0.07 * Math.sin(now / 900);
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centered = sample - 128;
          sum += centered * centered;
        }
        target = Math.min(1, (Math.sqrt(sum / samples.length) / 128) * 3.2);
      }
      level += (target - level) * (target > level ? 0.45 : 0.07);
      rotation = (rotation + dt * (10 + level * 140)) % 360;
      sphere.style.transform = `scale(${(1 + level * 0.14).toFixed(4)})`;
      blobs.style.transform = `rotate(${rotation.toFixed(2)}deg) scale(${(1 + level * 0.3).toFixed(4)})`;
      glow.style.opacity = (0.5 + level * 0.5).toFixed(3);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (audio) void audio.close();
    };
  }, [stream, reducedMotion]);

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
            className="absolute rounded-full mix-blend-screen blur-xl"
            style={{
              width: '55%',
              height: '55%',
              left: '-4%',
              top: '8%',
              background:
                'radial-gradient(closest-side, color-mix(in srgb, var(--droid-skill) 60%, transparent), transparent)',
            }}
          />
          <div
            className="absolute rounded-full mix-blend-screen blur-xl"
            style={{
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
          className="absolute inset-0 rounded-full mix-blend-screen"
          style={{
            background:
              'radial-gradient(circle at 32% 26%, rgb(255 255 255 / 0.85), transparent 45%)',
          }}
        />
      </div>
    </div>
  );
}
