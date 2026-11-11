// Pointer and wheel input sent straight to the browser on an 8.33 ms (120 Hz)
// schedule. Playwright's mouse waits for the page to take each event before
// sending the next, and Chromium hands input to the page once per frame, so
// through it every event costs a whole frame and a stream runs at the page's
// rate instead of the device's. Here events go out on time and queue in the
// browser, as a trackpad's do, and a stream waits for all of them at its end.

import { setTimeout as sleep } from 'node:timers/promises';
import type { CDPSession, Page } from '@playwright/test';

const EVENT_INTERVAL_MS = 1000 / 120;

export interface Point {
  x: number;
  y: number;
}

/** CDP's modifier bits. */
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIERS;

interface MouseEventParameters extends Point {
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel';
  button?: 'none' | 'left';
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers: number;
}

export class PacedInput {
  private modifiers = 0;
  private pressed = false;
  private readonly sent: Promise<unknown>[] = [];

  private constructor(
    private readonly page: Page,
    private readonly session: CDPSession,
  ) {}

  static async open(page: Page): Promise<PacedInput> {
    return new PacedInput(page, await page.context().newCDPSession(page));
  }

  /** Holds a modifier key down, for the page's key events and every pointer event after. */
  async hold(key: Modifier) {
    await this.page.keyboard.down(key);
    this.modifiers |= MODIFIERS[key];
  }

  async release(key: Modifier) {
    await this.flush();
    await this.page.keyboard.up(key);
    this.modifiers &= ~MODIFIERS[key];
  }

  /** Sends `count` events from `send`, the i-th at i × 8.33 ms after the first. */
  async stream(count: number, send: (index: number) => void) {
    const start = performance.now();
    for (let index = 0; index < count; index += 1) {
      const wait = start + index * EVENT_INTERVAL_MS - performance.now();
      if (wait > 0) await sleep(wait);
      send(index);
    }
    await this.flush();
  }

  move(at: Point) {
    this.mouse('mouseMoved', at);
  }

  press(at: Point) {
    this.pressed = true;
    this.mouse('mousePressed', at);
  }

  lift(at: Point) {
    this.pressed = false;
    this.mouse('mouseReleased', at);
  }

  wheel(at: Point, deltaY: number) {
    this.dispatch({
      type: 'mouseWheel',
      ...at,
      deltaX: 0,
      deltaY,
      modifiers: this.modifiers,
    });
  }

  async flush() {
    await Promise.all(this.sent.splice(0));
  }

  private mouse(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', at: Point) {
    this.dispatch({
      type,
      ...at,
      button: this.pressed || type === 'mouseReleased' ? 'left' : 'none',
      buttons: this.pressed ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      modifiers: this.modifiers,
    });
  }

  private dispatch(event: MouseEventParameters) {
    this.sent.push(this.session.send('Input.dispatchMouseEvent', event));
  }
}
