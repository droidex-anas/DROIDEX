import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The voice orb: layered light rather than a shaded ball. Two analysers read
 * the microphone and the reply, and a single rAF loop writes transforms and
 * opacities straight to the DOM, so the orb tracks the conversation at 60fps
 * without ever re-rendering React.
 *
 * Listening pulls the light inward — the core tightens, the cool halo holds
 * close. Speaking pushes it outward — the warm halo blooms, a highlight travels
 * around the rim, the inner lobes swing wide. With neither stream carrying
 * sound it breathes on a slow offset cycle, so it is never flat and never
 * jumps when a stream appears or goes away.
 */

/** Envelope timings: catch a syllable, let go of it slowly. */
const ATTACK_SECONDS = 0.05;
const RELEASE_SECONDS = 0.34;
/** Below this RMS the signal is room tone, not speech. */
const NOISE_FLOOR = 0.006;
/** What the reply reads as while the provider says it is speaking but is quiet. */
const SPEAKING_FLOOR = 0.2;

/**
 * The three light lobes drifting under the surface. `reach` is a percentage of
 * the lobe's own width, so every distance scales with the orb.
 */
const LOBES = [
  { extent: '76%', reach: 15, rate: 1, phase: 0, tint: 'var(--droid-skill)' },
  { extent: '68%', reach: 19, rate: -0.62, phase: 120, tint: 'var(--droid-ultra)' },
  { extent: '54%', reach: 11, rate: 0.41, phase: 238, tint: 'var(--droid-accent)' },
];

/** One lobe's pose, shared by the resting render and every animated frame. */
function lobePose(angle: number, reach: number, scale: number): string {
  return `translate(-50%, -50%) rotate(${angle.toFixed(2)}deg) translateX(${reach.toFixed(2)}%) scale(${scale.toFixed(4)})`;
}

/**
 * Alpha masks, not colours: they only say how much of a layer survives at each
 * radius. `softEdge` keeps the orb from ending in a hard circle, `ringMask`
 * keeps the travelling highlight on the rim.
 */
const SOFT_EDGE = 'radial-gradient(circle at 50% 50%, #000 56%, #000000b0 82%, transparent 100%)';
const RING_MASK = 'radial-gradient(circle at 50% 50%, transparent 56%, #000 79%, transparent 99%)';

/** Frame-rate independent follower: fast on the way up, slow on the way down. */
function follow(current: number, target: number, dt: number): number {
  const tau = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Perceptual 0..1 loudness from an analyser, or 0 when there is no stream. */
function loudness(analyser: AnalyserNode | null, samples: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.max(0, rms - NOISE_FLOOR) ** 0.7 * 3.1);
}

export function VoiceOrb({
  micStream,
  replyStream,
  speaking = false,
  size = 220,
}: {
  micStream: MediaStream | null;
  replyStream: MediaStream | null;
  speaking?: boolean;
  size?: number;
}) {
  const coolRef = useRef<HTMLDivElement>(null);
  const warmRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const lobeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reducedMotion = useReducedMotion();

  // The loop reads `speaking` without being torn down and rebuilt for it, so a
  // reply starting never costs an AudioContext.
  const speakingRef = useRef(speaking);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    const cool = coolRef.current;
    const warm = warmRef.current;
    const core = coreRef.current;
    const focus = focusRef.current;
    const sweep = sweepRef.current;
    const rim = rimRef.current;
    const lobes = lobeRefs.current.filter((lobe): lobe is HTMLDivElement => lobe !== null);
    if (reducedMotion || !cool || !warm || !core || !focus || !sweep || !rim) return;

    const carries = (stream: MediaStream | null) => Boolean(stream?.getAudioTracks().length);
    const audio = carries(micStream) || carries(replyStream) ? new AudioContext() : null;
    const nodes: AudioNode[] = [];
    const listenTo = (stream: MediaStream | null): AnalyserNode | null => {
      if (!audio || !carries(stream) || !stream) return null;
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      // The analyser's own smoothing absorbs plosives; the envelope below shapes
      // the rest. Together they keep transients from twitching the orb.
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      nodes.push(source, analyser);
      return analyser;
    };
    const micAnalyser = listenTo(micStream);
    const replyAnalyser = listenTo(replyStream);
    if (audio?.state === 'suspended') void audio.resume();
    const samples = new Uint8Array(1024);

    let listen = 0;
    let reply = 0;
    let spin = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      listen = follow(listen, loudness(micAnalyser, samples), dt);
      const replyTarget = Math.max(
        loudness(replyAnalyser, samples),
        speakingRef.current ? SPEAKING_FLOOR : 0,
      );
      reply = follow(reply, replyTarget, dt);

      // Two offset slow cycles: one breathes the whole orb, the other drifts the
      // hue between cool and warm so a silent orb still changes.
      const breath = 0.5 + 0.5 * Math.sin(now / 1900);
      const drift = 0.5 + 0.5 * Math.sin(now / 5200);
      // Breathing hands over to the voice instead of adding to it, so neither
      // the start nor the end of a stream lands as a jump.
      const sway = (breath - 0.5) * (1 - Math.min(1, listen + reply));

      spin = (spin + dt * (7 + listen * 12 + reply * 46)) % 360;

      core.style.transform = `scale(${(1 + sway * 0.045 + reply * 0.085 - listen * 0.02).toFixed(4)})`;
      cool.style.opacity = (0.16 + 0.06 * drift + listen * 0.52).toFixed(3);
      cool.style.transform = `scale(${(0.9 + sway * 0.05 + listen * 0.09 - reply * 0.03).toFixed(4)})`;
      warm.style.opacity = (0.14 + 0.06 * (1 - drift) + reply * 0.62).toFixed(3);
      warm.style.transform = `scale(${(0.94 + sway * 0.07 + reply * 0.28).toFixed(4)})`;
      // Attention concentrates: the centre gets brighter and smaller while the
      // user talks, and stays open while the orb answers.
      focus.style.opacity = (0.16 + 0.05 * breath + listen * 0.5 + reply * 0.22).toFixed(3);
      focus.style.transform = `scale(${(0.92 - listen * 0.17 + reply * 0.2).toFixed(4)})`;
      rim.style.opacity = (0.28 + listen * 0.26 + reply * 0.46).toFixed(3);
      sweep.style.opacity = (reply * 0.72).toFixed(3);
      sweep.style.transform = `rotate(${(spin * 2.2).toFixed(2)}deg)`;

      for (let i = 0; i < lobes.length; i += 1) {
        const lobe = LOBES[i];
        const reach = lobe.reach + reply * 9 - listen * 5;
        const scale = 1 + sway * (0.08 + i * 0.03) + reply * 0.2 - listen * 0.05;
        lobes[i].style.transform = lobePose(lobe.phase + spin * lobe.rate, reach, scale);
      }

      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frame);
      for (const node of nodes) node.disconnect();
      if (audio) void audio.close();
    };
  }, [micStream, replyStream, reducedMotion]);

  // Reduced motion gets a still orb with no loop at all; it still shows whether
  // the voice is speaking, because that is a state, not movement. While the
  // loop runs these values never change between renders, so React's style diff
  // is empty and nothing it does can clobber a frame.
  const stillSpeaking = reducedMotion === true && speaking;

  return (
    <div className="relative shrink-0" aria-hidden style={{ width: size, height: size }}>
      <div
        ref={coolRef}
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: '-30%',
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--droid-skill) 68%, transparent), color-mix(in srgb, var(--droid-skill) 16%, transparent) 52%, transparent 76%)',
          filter: `blur(${(size * 0.1).toFixed(1)}px)`,
          transform: 'scale(0.9)',
          opacity: stillSpeaking ? 0.18 : 0.3,
        }}
      />
      <div
        ref={warmRef}
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: '-34%',
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--droid-ultra) 62%, transparent), color-mix(in srgb, var(--droid-ultra) 14%, transparent) 55%, transparent 78%)',
          filter: `blur(${(size * 0.13).toFixed(1)}px)`,
          transform: 'scale(0.94)',
          opacity: stillSpeaking ? 0.62 : 0.18,
        }}
      />

      {/* The body. `isolate` keeps the screen blending between the orb's own
          layers, so it reads the same over any theme's background. */}
      <div
        ref={coreRef}
        className="absolute inset-0"
        style={{
          isolation: 'isolate',
          transform: 'scale(1)',
          maskImage: SOFT_EDGE,
          WebkitMaskImage: SOFT_EDGE,
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--droid-skill) 24%, var(--droid-bg)), color-mix(in srgb, var(--droid-ultra) 20%, var(--droid-bg)) 60%, var(--droid-bg) 100%)',
          }}
        />

        {LOBES.map((lobe, index) => (
          <div
            key={lobe.phase}
            className="absolute rounded-full"
            ref={(node) => {
              lobeRefs.current[index] = node;
            }}
            style={{
              left: '50%',
              top: '50%',
              width: lobe.extent,
              height: lobe.extent,
              mixBlendMode: 'screen',
              filter: `blur(${(size * 0.085).toFixed(1)}px)`,
              background: `radial-gradient(closest-side, color-mix(in srgb, ${lobe.tint} 58%, transparent), transparent)`,
              transform: lobePose(lobe.phase, lobe.reach, 1),
            }}
          />
        ))}

        <div
          ref={focusRef}
          className="absolute inset-0 rounded-full"
          style={{
            mixBlendMode: 'screen',
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--droid-accent) 72%, transparent), color-mix(in srgb, var(--droid-skill) 30%, transparent) 46%, transparent 72%)',
            filter: `blur(${(size * 0.06).toFixed(1)}px)`,
            transform: 'scale(0.92)',
            opacity: stillSpeaking ? 0.42 : 0.24,
          }}
        />

        {/* A highlight travelling round the rim: the orb emitting, not a shine. */}
        <div
          ref={sweepRef}
          className="absolute inset-0"
          style={{
            mixBlendMode: 'screen',
            background:
              'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--droid-accent) 55%, transparent) 42deg, color-mix(in srgb, var(--droid-ultra) 70%, transparent) 92deg, transparent 168deg)',
            maskImage: RING_MASK,
            WebkitMaskImage: RING_MASK,
            filter: `blur(${(size * 0.035).toFixed(1)}px)`,
            transform: 'rotate(0deg)',
            opacity: stillSpeaking ? 0.34 : 0,
          }}
        />

        <div
          ref={rimRef}
          className="absolute inset-0 rounded-full"
          style={{
            mixBlendMode: 'screen',
            background:
              'radial-gradient(circle at 50% 50%, transparent 62%, color-mix(in srgb, var(--droid-skill) 42%, transparent) 84%, color-mix(in srgb, var(--droid-ultra) 52%, transparent) 93%, transparent 100%)',
            filter: `blur(${(size * 0.022).toFixed(1)}px)`,
            opacity: stillSpeaking ? 0.62 : 0.34,
          }}
        />
      </div>
    </div>
  );
}
