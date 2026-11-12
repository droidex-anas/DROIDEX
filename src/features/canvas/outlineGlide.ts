// How an element outline glides to a changed box by transform alone: the box
// slides from where it was, its line (drawn by `::before`) scales from the
// size it had, and what hangs from the line's bottom slides with it, so a
// chip never leaves the line it labels. Text is only ever translated, never
// scaled. One glide runs at a time: a box that changes mid-glide starts a new
// one from where the running one shows it, so the line and its chip never part.

import type { Box } from './elementOnBoard';

/** Where a child of the outline hangs from its box, if a change of size moves it. */
export type GlideAnchor = 'bottom' | 'bottom-centre';

interface Glide {
  from: Box;
  to: Box;
  /** Its animations, which share one timing. */
  animations: Animation[];
}

export class OutlineGlide {
  private running: Glide | null = null;

  /**
   * Glides `element`, already drawn at `to`, from where it is shown: where a
   * running glide has it, else `previous`. Reduced motion jumps instead.
   */
  glide(element: HTMLElement, previous: Box, to: Box): void {
    const from = this.shown() ?? previous;
    this.stop();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animations: Animation[] = [];
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx !== 0 || dy !== 0)
      animations.push(
        run(element, { transform: [`translate(${String(dx)}px, ${String(dy)}px)`, 'none'] }),
      );
    // An axis with no size has no line to scale, and the other still glides.
    const sx = to.width === 0 ? 1 : from.width / to.width;
    const sy = to.height === 0 ? 1 : from.height / to.height;
    if (sx !== 1 || sy !== 1) {
      animations.push(
        run(element, { transform: [`scale(${String(sx)}, ${String(sy)})`, 'none'] }, '::before'),
      );
      // Where the scaled line's bottom and middle start, from where they end.
      const bottom = to.height * (sy - 1);
      const middle = (to.width * (sx - 1)) / 2;
      for (const child of element.querySelectorAll<HTMLElement>(':scope > [data-glide-anchor]')) {
        const across = child.dataset.glideAnchor === 'bottom-centre' ? middle : 0;
        // `translate`, which applies before the chip's own screen-size scale.
        animations.push(
          run(child, { translate: [`${String(across)}px ${String(bottom)}px`, '0px 0px'] }),
        );
      }
    }
    if (animations.length > 0) this.running = { from, to, animations };
  }

  /** Ends the glide where it is going. */
  stop(): void {
    for (const animation of this.running?.animations ?? []) animation.cancel();
    this.running = null;
  }

  /** The box the running glide shows now, from its eased progress, so no layout is read. */
  private shown(): Box | null {
    if (!this.running) return null;
    const { from, to, animations } = this.running;
    // Null once the glide has finished or been cancelled.
    const progress = animations[0].effect?.getComputedTiming().progress;
    if (progress === null || progress === undefined) return null;
    const along = (start: number, end: number) => start + (end - start) * progress;
    return {
      left: along(from.left, to.left),
      top: along(from.top, to.top),
      width: along(from.width, to.width),
      height: along(from.height, to.height),
    };
  }
}

/** One part of a glide, added to the transform or translate the part is drawn at. */
function run(
  target: HTMLElement,
  keyframes: PropertyIndexedKeyframes,
  pseudoElement?: string,
): Animation {
  return target.animate(keyframes, { ...glideTiming(), composite: 'add', pseudoElement });
}

let timingTokens: { duration: number; easing: string } | null = null;

/** The quick duration and smooth easing tokens, read once: they never change while the app runs. */
function glideTiming(): { duration: number; easing: string } {
  if (timingTokens) return timingTokens;
  const tokens = getComputedStyle(document.documentElement);
  // The duration token is written in milliseconds.
  timingTokens = {
    duration: parseFloat(tokens.getPropertyValue('--duration-quick')),
    easing: tokens.getPropertyValue('--ease-smooth-out').trim(),
  };
  return timingTokens;
}
