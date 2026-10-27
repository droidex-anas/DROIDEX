// The board harness page: its dev server, opening it at a known clock and
// zoom, and stand-ins for the preview host's guests.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type {} from './CanvasBoardHarness';

declare global {
  interface Window {
    boardGuestReady: boolean;
    guestCommands: Record<string, unknown>[];
    guestAnswer: (command: string, argument: Record<string, unknown>) => unknown;
  }
}

let url = '';

/** Serves the harness for the calling spec file's tests. */
export function serveBoard() {
  let server: ViteDevServer | undefined;
  test.beforeAll(async () => {
    server = await createServer({
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing board server');
    url = `http://127.0.0.1:${address.port}/tests/smoke/board/index.html`;
  });
  test.afterAll(async () => {
    await server?.close();
  });
}

export function boardUrl(query: string) {
  return `${url}?${query}`;
}

export async function openBoard(
  page: Page,
  font = 14,
  reducedMotion: 'reduce' | 'no-preference' = 'reduce',
  query = '',
) {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion });
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T12:01:00Z'));
  await page.goto(boardUrl(`font=${font}${query}`));
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  // The opening Fit: 72 px of padding each side in a 1000 px board, about 90%.
  await expect(page.getByTestId('canvas-board').getByText('90%', { exact: true })).toBeVisible();
  await page.clock.runFor(32);
}

/**
 * Stands in for the preview host: every `<webview>` the board makes answers as
 * guest 41, bound to this canvas, and reports ready once `boardGuestReady` is set.
 * Pick and select commands are recorded in `guestCommands` and answered by
 * `guestAnswer`.
 */
export async function stubGuests(page: Page) {
  await page.addInitScript(() => {
    window.boardGuestReady = false;
    window.guestCommands = [];
    window.guestAnswer = () => null;
    Object.defineProperty(window, 'droidControl', {
      value: {
        canvasPreviewUrl: 'droidex-canvas-preview://preview/guest',
        canvasPreviewBind: async (guestId: number, canvasId: string) =>
          guestId === 41 && canvasId === 'cv_board',
        canvasPreviewCapture: async () => ({
          ok: false,
          error: { code: 'capture_unavailable', message: 'No capture in the DOM harness.' },
        }),
      },
    });
    const create = document.createElement.bind(document);
    Object.defineProperty(document, 'createElement', {
      value: (tag: string) => {
        const guest = create(tag);
        if (tag !== 'webview') return guest;
        let identity = {};
        let sent = false;
        const answers: { event: 'selection'; element: unknown }[] = [];
        Object.assign(guest, {
          getWebContentsId: () => 41,
          executeJavaScript: async (script: string) => {
            const call = /^globalThis\.__droidexCanvasPreview\.(\w+)\((.*)\)$/s.exec(script);
            const argument = call?.[2] ? JSON.parse(call[2]) : null;
            if (call?.[1] === 'start') {
              identity = argument;
              return 'started';
            }
            if (call?.[1] === 'pick' || call?.[1] === 'select') {
              window.guestCommands.push({ command: call[1], ...argument });
              answers.push({ event: 'selection', element: window.guestAnswer(call[1], argument) });
              return 'sent';
            }
            const events = window.boardGuestReady && !sent ? [{ event: 'ready' }] : [];
            if (events.length > 0) sent = true;
            events.push(...answers.splice(0));
            return JSON.stringify({ ...identity, events, dropped: 0 });
          },
        });
        queueMicrotask(() => guest.dispatchEvent(new Event('dom-ready')));
        return guest;
      },
    });
  });
}

export function frame(page: Page, name: string): Locator {
  return page.getByText(`Design ${name}`, { exact: true }).locator('..').locator('..');
}

export async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Missing frame box');
  return rect;
}
