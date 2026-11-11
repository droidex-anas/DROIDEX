// The canvas scenario's board: the tree's own board harness, built for
// production and served once, and a page on it holding a grid of 30 or 100
// frames with named designs and stand-in guests, fitted at real timers.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { stubGuests } from '../../smoke/board/boardPage';
import { FRAME_MARK, installProbe, NAME_SHIM } from './probe';

export interface ServedHarness {
  url: string;
  close: () => Promise<void>;
}

/** Builds the tree's board harness in production mode and serves it on a free port. */
export async function serveHarness(treeRoot: string): Promise<ServedHarness> {
  const outDir = await mkdtemp(join(tmpdir(), 'droidex-canvas-perf-'));
  const configFile = join(treeRoot, 'vite.config.ts');
  await build({
    root: treeRoot,
    configFile,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: { input: join(treeRoot, 'tests/smoke/board/index.html') },
    },
  });
  const server = await preview({
    root: treeRoot,
    configFile,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('The harness server has no port.');
  return {
    url: `http://127.0.0.1:${String(address.port)}/tests/smoke/board/index.html`,
    close: async () => {
      await server.close();
      await rm(outDir, { recursive: true, force: true });
    },
  };
}

export type BoardTool = 'board' | 'edit' | 'layers';

const NAMES = [
  'Pricing',
  'Onboarding step',
  'Settings',
  'Checkout',
  'Team dashboard',
  'Profile',
  'Search results',
  'Empty state',
  'Sign in',
  'Billing history',
];

/** The grid's design ids, in the harness's order: A, B, then X0 onwards. */
function designIds(frames: number): string[] {
  const extra = Array.from({ length: frames - 2 }, (_, index) => `x${String(index)}`);
  return ['a', 'b', ...extra];
}

/**
 * Opens a page on a board of `frames` designs laid out in a near-square grid,
 * with the probe installed, guests ready and the board fitted and settled.
 */
export async function openGrid(
  browser: Browser,
  harnessUrl: string,
  frames: number,
  tool: BoardTool,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1300, height: 1100 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.addInitScript({ content: NAME_SHIM });
  await page.addInitScript({
    content: `(${installProbe.toString()})(${JSON.stringify(FRAME_MARK)});`,
  });
  await stubGuests(page);
  if (tool === 'edit') await page.addInitScript({ content: `(${answerHovers.toString()})();` });
  const tools = { board: '', edit: '&edit=1', layers: '&layers=1' }[tool];
  await page.goto(`${harnessUrl}?font=14&preview=guest&frames=${String(frames)}${tools}`);
  const board = page.getByTestId('canvas-board');
  await expect(board).toBeVisible();

  const ids = designIds(frames);
  const columns = Math.ceil(Math.sqrt(frames));
  await page.evaluate(
    ({ ids, columns }) => {
      window.boardGuestReady = true;
      ids.forEach((designId, index) => {
        const x = (index % columns) * 450;
        const y = Math.floor(index / columns) * 350;
        window.boardHarness.publish(designId, { x, y, width: 400, height: 300 }, 4);
      });
    },
    { ids, columns },
  );
  // A manifest commit reads the board as last rendered, so each waits for the one before.
  for (const [index, designId] of ids.entries()) {
    const name = `${NAMES[index % NAMES.length]} ${String(Math.floor(index / NAMES.length) + 1)}`;
    await page.evaluate(
      ([designId, name]) =>
        new Promise<void>((resolve) => {
          window.boardHarness.commitManifest(designId, name);
          requestAnimationFrame(() => resolve());
        }),
      [designId, name],
    );
  }
  await expect(page.locator(`[data-design-frame="${ids.at(-1) ?? ''}"]`)).toContainText(
    NAMES[(ids.length - 1) % NAMES.length],
  );
  await board.focus();
  await page.keyboard.press('Shift+Digit1');
  await expect(page.locator('[data-preview-phase="ready"]').first()).toBeVisible();
  await settle(page);
  return page;
}

/** Waits out the board's glides and the slots and answers they start. */
export async function settle(page: Page) {
  await page.waitForTimeout(600);
}

/**
 * Every guest answers a hover by the design's own pixels, as a page of a
 * header over a card over a footer would.
 */
function answerHovers() {
  const header = { elementId: 'el_title', instancePath: '0/0', tagName: 'h1' };
  const card = { elementId: 'el_card', instancePath: '0', tagName: 'section' };
  window.guestAnswer = (command, argument) => {
    const point = argument as { y?: number; target?: { elementId: string } };
    if (command === 'select') {
      if (!point.target) return null;
      const element = point.target.elementId === 'el_title' ? header : card;
      return {
        ...element,
        rect: { x: 8, y: 8, width: 240, height: 30 },
        styles: { fontSize: '24px' },
      };
    }
    const y = point.y ?? 0;
    const element = y < 40 ? header : card;
    const rect =
      element === header
        ? { x: 8, y: 8, width: 240, height: 30 }
        : { x: 0, y: 0, width: 400, height: 300 };
    return command === 'hover'
      ? { ...element, rect }
      : { ...element, rect, styles: { fontSize: '24px' } };
  };
}
