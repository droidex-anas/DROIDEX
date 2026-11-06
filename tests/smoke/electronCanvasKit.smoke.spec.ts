import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import { readDesignSystem } from '../../sidecar/src/canvas/designSystems';
import {
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
  type PreviewInstance,
} from '../../src/features/canvas/previewDocument';
import { askGuest, compileDesign, drainGuest, mountPreviewGuest } from './canvasPreviewHost';
import { focusHost, withCanvasHost } from './canvasSmoke';

function newInstance(designId: string): PreviewInstance {
  return { nonce: previewNonce(), designId, revisionId: `rev_${designId}`, generation: 1 };
}

function isRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number' &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number'
  );
}

const BUTTON_NAME = `(button) => button.getAttribute('aria-label') ?? button.textContent?.trim()`;

const button = (name: string): string =>
  `[...document.querySelectorAll("button")].find(button => (${BUTTON_NAME})(button) === ${JSON.stringify(name)})`;

test('a kit dialog keeps keyboard focus in the real preview guest and returns it after closing', async () => {
  const example = (await readDesignSystem({ id: 'droidex', version: 1 })).examples['Dialog.tsx'];
  assert.ok(example);
  const design = await compileDesign({ 'main.tsx': example });

  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    assert.equal(
      await askGuest(page, previewStartScript(newInstance('kit-dialog'), design.html)),
      PREVIEW_STARTED,
    );
    const generated = (script: string): Promise<unknown> =>
      app.evaluate(
        ({ webContents }, { id, code }) =>
          webContents.fromId(id)?.mainFrame.frames[0]?.executeJavaScript(code),
        { id: guestId, code: script },
      );
    await expect
      .poll(() => generated('Boolean(document.querySelector("dialog")?.open)'), {
        timeout: 20_000,
      })
      .toBe(true);
    await generated('document.fonts.ready.then(() => true)');
    await focusHost(app);

    // A press reaches the design's process after mouse.click returns, so a
    // control the previous press reveals (the dialog's buttons) can still be
    // hidden, with an empty box at the origin. Wait until it shows.
    const click = async (expression: string): Promise<void> => {
      let rect: unknown;
      await expect
        .poll(async () => {
          rect = await generated(`(() => {
            const target = ${expression};
            if (!target) throw new Error('Missing kit control');
            target.scrollIntoView({ block: 'center' });
            const { x, y, width, height } = target.getBoundingClientRect();
            return { x, y, width, height };
          })()`);
          return isRect(rect) && rect.width > 0 && rect.height > 0;
        })
        .toBe(true);
      assert.ok(isRect(rect));
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 300);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    };
    const active = () =>
      generated(`(() => ({
        open: document.querySelector('dialog')?.open,
        focused: document.activeElement?.tagName === 'BUTTON' ? (${BUTTON_NAME})(document.activeElement) : document.activeElement?.tagName,
        inDialog: document.querySelector('dialog')?.contains(document.activeElement),
        hasFocus: document.hasFocus(),
      }))()`);
    const focused = async () => ((await active()) as { focused: unknown }).focused;
    const layout = () =>
      generated(`(() => ({
        clientWidth: document.documentElement.clientWidth,
        openerLeft: ${button('Delete chat')}?.getBoundingClientRect().left + window.scrollX,
      }))()`);

    // The example opens with its dialog showing.
    await click(button('Cancel'));
    await expect.poll(() => generated('document.querySelector("dialog")?.open')).toBe(false);
    const layoutBeforeDialog = await layout();

    await click(button('Delete chat'));
    await expect
      .poll(() => active())
      .toEqual({ open: true, focused: 'Close dialog', inDialog: true, hasFocus: true });
    assert.deepEqual(await layout(), layoutBeforeDialog);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Cancel');
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Delete');
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Close dialog');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(), 'Delete');
    await page.keyboard.press('Escape');
    await expect
      .poll(() => active())
      .toEqual({ open: false, focused: 'Delete chat', inDialog: false, hasFocus: true });

    await click(button('Delete chat'));
    await click(button('Delete'));
    await expect
      .poll(() => active())
      .toEqual({ open: false, focused: 'Delete chat', inDialog: false, hasFocus: true });
  });
});

test('a full-bleed Auto kit design paints its capture to the right edge', async () => {
  const design = await compileDesign(
    {
      'main.tsx': `export default () => <main style={{ minHeight: '100vh', background: 'rgb(0 0 255)' }} />;`,
    },
    { id: 'auto', version: 1, mode: 'dark' },
  );

  await withCanvasHost(async (_app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('kit-bleed');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    const rightEdge = await page.evaluate(
      async ({ guestId, designId, revisionId }) => {
        const captured = await window.droidex?.canvasPreviewCapture({
          requestId: 'smoke_bleed',
          guestId,
          canvasId: 'cv_smoke',
          designId,
          revisionId,
          generation: 1,
          width: 400,
          height: 300,
          scaleFactor: window.devicePixelRatio,
        });
        if (!captured?.ok) throw new Error(JSON.stringify(captured));
        const bitmap = await createImageBitmap(new Blob([captured.bytes], { type: 'image/png' }));
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        if (!context) throw new Error('Missing image decoder');
        context.drawImage(bitmap, 0, 0);
        return [...context.getImageData(bitmap.width - 1, bitmap.height / 2, 1, 1).data];
      },
      { guestId, designId: instance.designId, revisionId: instance.revisionId },
    );
    assert.deepEqual(rightEdge, [0, 0, 255, 255]);
  });
});
