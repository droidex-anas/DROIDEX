import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import { HEY_TSX } from '../../sidecar/src/canvas/presets/starter';
import {
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
  type PreviewInstance,
} from '../../src/features/canvas/previewDocument';
import { askGuest, compileDesign, mountPreviewGuest } from './canvasPreviewHost';
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

test('a kit dialog keeps keyboard focus in the real preview guest and returns it after closing', async () => {
  const design = await compileDesign({ 'main.tsx': HEY_TSX });

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
      .poll(() => generated('Boolean(document.querySelector("[role=tab]"))'), {
        timeout: 20_000,
      })
      .toBe(true);
    await generated('document.fonts.ready.then(() => true)');
    await focusHost(app);

    const click = async (expression: string): Promise<void> => {
      const rect = await generated(`(() => {
        const target = ${expression};
        if (!target) throw new Error('Missing kit control');
        target.scrollIntoView({ block: 'center' });
        const { x, y, width, height } = target.getBoundingClientRect();
        return { x, y, width, height };
      })()`);
      assert.ok(isRect(rect));
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 300);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    };
    const active = () =>
      generated(`(() => ({
        open: document.querySelector('dialog')?.open,
        tag: document.activeElement?.tagName,
        text: document.activeElement?.tagName === 'BUTTON' ? document.activeElement.textContent?.trim() : null,
        placeholder: document.activeElement?.getAttribute('placeholder'),
        inDialog: document.querySelector('dialog')?.contains(document.activeElement),
        hasFocus: document.hasFocus(),
      }))()`);
    const layout = () =>
      generated(`(() => ({
        clientWidth: document.documentElement.clientWidth,
        cardLeft: document.querySelector('.ds-card')?.getBoundingClientRect().left,
      }))()`);

    await click('document.querySelectorAll("[role=tab]")[1]');
    const layoutBeforeDialog = await layout();
    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "How it works")',
    );
    assert.deepEqual(await layout(), layoutBeforeDialog);
    assert.deepEqual(await active(), {
      open: true,
      tag: 'BUTTON',
      text: 'Close',
      placeholder: null,
      inDialog: true,
      hasFocus: true,
    });
    await page.keyboard.press('Tab');
    assert.equal(
      await generated(
        'document.activeElement?.tagName === "BUTTON" ? document.activeElement.textContent?.trim() : null',
      ),
      'Try it',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await generated(
        'document.activeElement?.tagName === "BUTTON" ? document.activeElement.textContent?.trim() : null',
      ),
      'Close',
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await generated(
        'document.activeElement?.tagName === "BUTTON" ? document.activeElement.textContent?.trim() : null',
      ),
      'Try it',
    );
    await page.keyboard.press('Escape');
    assert.deepEqual(await active(), {
      open: false,
      tag: 'BUTTON',
      text: 'How it works',
      placeholder: null,
      inDialog: false,
      hasFocus: true,
    });

    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "How it works")',
    );
    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Try it")',
    );
    await expect
      .poll(() => active())
      .toEqual({
        open: false,
        tag: 'INPUT',
        text: null,
        placeholder: 'How should we call you?',
        inDialog: false,
        hasFocus: true,
      });

    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.includes("Get started"))',
    );
    assert.equal(await generated('document.querySelector("input")?.disabled'), true);
    await click('document.querySelectorAll("[role=tab]")[1]');
    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "How it works")',
    );
    await click(
      '[...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Try it")',
    );
    await expect
      .poll(() => active())
      .toEqual({
        open: false,
        tag: 'BUTTON',
        text: 'Start over',
        placeholder: null,
        inDialog: false,
        hasFocus: true,
      });
    assert.equal(await generated('document.activeElement?.matches(":disabled")'), false);
  });
});
