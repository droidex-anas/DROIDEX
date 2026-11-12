// How an element outline glides to a changed box by transform alone: the box
// slides from where it was, its line (drawn by `::before`) scales from the
// size it had, and what hangs from the line's bottom slides with it, so a
// chip never leaves the line it labels. Text is only ever translated, never
// scaled. Each glide adds to any still running, so a box that changes
// mid-glide carries on from where it is shown.

import type { Box } from './elementOnBoard';

/** Where a child of the outline hangs from its box, if a change of size moves it. */
export type GlideAnchor = 'bottom' | 'bottom-centre';

export class OutlineGlide {
  private readonly running = new Set<Animation>();

  /** Glides `element`, already drawn at `to`, from `from`; reduced motion jumps instead. */
  glide(element: HTMLElement, from: Box, to: Box): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.stop();
      return;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx !== 0 || dy !== 0)
      this.run(element, {
        transform: [`translate(${String(dx)}px, ${String(dy)}px)`, 'none'],
      });
    // An axis with no size has no line to scale, and the other still glides.
    const sx = to.width === 0 ? 1 : from.width / to.width;
    const sy = to.height === 0 ? 1 : from.height / to.height;
    if (sx === 1 && sy === 1) return;
    this.run(element, { transform: [`scale(${String(sx)}, ${String(sy)})`, 'none'] }, '::before');
    // Where the scaled line's bottom and middle start, from where they end.
    const bottom = to.height * (sy - 1);
    const middle = (to.width * (sx - 1)) / 2;
    for (const child of element.querySelectorAll<HTMLElement>(':scope > [data-glide-anchor]')) {
      const across = child.dataset.glideAnchor === 'bottom-centre' ? middle : 0;
      // `translate`, which applies before the chip's own screen-size scale.
      this.run(child, { translate: [`${String(across)}px ${String(bottom)}px`, '0px 0px'] });
    }
  }

  /** Ends every glide where it is going. */
  stop(): void {
    for (const animation of this.running) animation.cancel();
    this.running.clear();
  }

  private run(target: HTMLElement, keyframes: PropertyIndexedKeyframes, pseudoElement?: string) {
    const animation = target.animate(keyframes, {
      ...glideTiming(),
      composite: 'add',
      pseudoElement,
    });
    this.running.add(animation);
    const forget = () => {
      this.running.delete(animation);
    };
    animation.onfinish = forget;
    animation.oncancel = forget;
  }
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
