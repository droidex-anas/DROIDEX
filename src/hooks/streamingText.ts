import { useEffect, useRef, useState } from 'react';

// Streamed tokens arrive in bursts. Revealing a fixed share of the backlog each
// frame races through every burst and then crawls, so text pulses. Instead the
// reveal runs at a rate that drains the backlog over TARGET_LAG_MS, eased frame
// to frame: a steady stream settles at its own arrival rate and reads as one
// even flow, while a large burst catches up as fast as MAX_CODE_POINTS_PER_FRAME
// allows (about 3,800 code points a second at 60Hz).
const TARGET_LAG_MS = 160;
const MIN_CODE_POINTS_PER_MS = 0.04;
const RATE_EASE_MS = 120;
const MAX_CODE_POINTS_PER_FRAME = 64;
// A frame gap longer than this (a hidden tab, a long task) is not reading time.
const MAX_FRAME_MS = 50;
// A stream that pauses this long ramps up again from rest when it resumes.
const RESTART_AFTER_MS = 250;

export function easedRevealRate(rate: number, backlog: number, elapsedMs: number): number {
  const target = Math.max(MIN_CODE_POINTS_PER_MS, backlog / TARGET_LAG_MS);
  return rate + (target - rate) * Math.min(1, elapsedMs / RATE_EASE_MS);
}

export function nextRevealedText(latest: string, current: string, codePoints: number): string {
  if (!latest.startsWith(current) || current.length >= latest.length) return latest;
  const step = Math.min(MAX_CODE_POINTS_PER_FRAME, codePoints);
  let index = current.length;
  let taken = 0;
  while (index < latest.length && taken < step) {
    const code = latest.charCodeAt(index);
    const next = index + 1 < latest.length ? latest.charCodeAt(index + 1) : 0;
    const paired = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    index += paired ? 2 : 1;
    taken += 1;
  }
  return latest.slice(0, index);
}

export function useSmoothStreamingText(source: string, live: boolean): string {
  const [shown, setShown] = useState(source);
  const shownRef = useRef(source);
  const sourceRef = useRef(source);
  const frameRef = useRef(0);
  const pace = useRef({ rate: 0, budget: 0, lastFrameAt: 0 });

  useEffect(() => {
    sourceRef.current = source;
    if (!live || typeof requestAnimationFrame !== 'function') {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      shownRef.current = source;
      setShown(source);
      return;
    }
    // Replaced or rewound text cannot be revealed incrementally; snap to it.
    if (!source.startsWith(shownRef.current)) {
      shownRef.current = source;
      setShown(source);
      return;
    }
    if (frameRef.current || shownRef.current.length >= source.length) return;
    const tick = (now: number) => {
      frameRef.current = 0;
      const latest = sourceRef.current;
      const current = shownRef.current;
      if (!latest.startsWith(current)) {
        shownRef.current = latest;
        setShown(latest);
        return;
      }
      if (current.length >= latest.length) return;
      const state = pace.current;
      const sinceLastFrame = now - state.lastFrameAt;
      if (sinceLastFrame > RESTART_AFTER_MS) {
        state.rate = 0;
        state.budget = 0;
      }
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, sinceLastFrame));
      state.lastFrameAt = now;
      state.rate = easedRevealRate(state.rate, latest.length - current.length, elapsed);
      state.budget += state.rate * elapsed;
      const take = Math.floor(state.budget);
      if (take > 0) {
        state.budget -= take;
        const next = nextRevealedText(latest, current, take);
        shownRef.current = next;
        setShown(next);
        if (next.length >= latest.length) return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [source, live]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return live ? shown : source;
}

// How long after the last streamed token the caret keeps blinking. The caret
// means "text is flowing", so an idle stream — including a wedged pending flag
// upstream — must not blink forever; fresh text restarts it.
const TYPING_IDLE_MS = 1600;

// The stream's last observed text and when it arrived, shared by every instance
// watching the same session (the feed's Working cue and the tail row's caret).
// A row that remounts around text that already idled — the virtualizer
// recycling the tail — must not restart its caret beside the cue that took
// over. The session keys the record, so another session whose tail happens to
// read the same is a stream of its own.
let lastSeen = { streamId: '', text: '', at: 0 };

function idleSince(streamId: string, text: string): boolean {
  if (lastSeen.streamId !== streamId || lastSeen.text !== text) return false;
  return Date.now() - lastSeen.at >= TYPING_IDLE_MS;
}

export function useStreamingActivity(streamId: string, text: string, active: boolean): boolean {
  const [typing, setTyping] = useState(() => active && !idleSince(streamId, text));
  // A stream that starts while this instance watches is fresh flow even when
  // its first text repeats an earlier turn's; only a mount around already
  // idle text (a recycled row) defers to the shared record.
  const wasActive = useRef(active);

  useEffect(() => {
    const fresh = active && !wasActive.current;
    wasActive.current = active;
    if (!active || (!fresh && idleSince(streamId, text))) {
      setTyping(false);
      return;
    }
    const known = lastSeen.streamId === streamId && lastSeen.text === text;
    if (fresh || !known) lastSeen = { streamId, text, at: Date.now() };
    setTyping(true);
    const timer = setTimeout(() => {
      setTyping(false);
    }, TYPING_IDLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [streamId, text, active]);

  return active && typing;
}
