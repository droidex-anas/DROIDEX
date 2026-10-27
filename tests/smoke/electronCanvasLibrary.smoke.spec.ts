// The library save's whole path with real pieces: the renderer shrinks a real
// capture main holds, the sidecar validates and stores it with the item, and
// the Design home's picker reads it back over the bridge. The one step that
// needs a provider — the send that places the armed item on a new canvas —
// stays covered by the seed's unit test, not here.

import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import { CHART_DESIGN } from '../../sidecar/src/canvas/fixtures/chart';
import { DEFAULT_DESIGN_SYSTEM_REF } from '../../sidecar/src/canvas/designSystems';
import { MAX_LIBRARY_THUMBNAIL_BASE64_LENGTH } from '../../src/features/canvas/wireValidation';
import { compileDesign, mountZoomedPreview } from './canvasPreviewHost';
import { withCanvasBridge, withCanvasHost } from './canvasSmoke';

const CHAT = 'library-smoke-chat';
const PNG_BASE64_PREFIX = 'iVBORw0KGgo';

test('a real capture becomes the item thumbnail the Design home picker shows', async () => {
  const design = await compileDesign(CHART_DESIGN);
  await withCanvasHost(
    async (_app, page) => {
      await withCanvasBridge(page, async (send) => {
        // A real canvas with one committed 640 × 400 frame, as a chat's flow makes it.
        const created = await send({
          type: 'canvas.createCanvas',
          appSessionId: CHAT,
          mutationId: 'library-smoke-canvas',
        });
        assert.ok(created.kind === 'canvasCreated');
        const { canvasId } = created;
        const reserved = await send({
          type: 'canvas.create',
          appSessionId: CHAT,
          canvasId,
          input: {
            mutationId: 'library-smoke-frame',
            frames: [
              { name: 'Hero', width: 640, height: 400, designSystem: DEFAULT_DESIGN_SYSTEM_REF },
            ],
          },
        });
        assert.ok(reserved.kind === 'created');
        const designId = reserved.created.frames[0]?.designId;
        assert.ok(designId);
        const written = await send({
          type: 'canvas.write',
          appSessionId: CHAT,
          canvasId,
          input: {
            mutationId: 'library-smoke-write',
            designId,
            expectedRevisionId: null,
            files: CHART_DESIGN,
            deletedPaths: [],
          },
        });
        assert.ok(written.kind === 'written');
        const revision = { designId, revisionId: written.receipt.revisionId };

        // The real preview of that revision captures itself into main's memory,
        // which is the only place a save's picture can come from.
        await mountZoomedPreview(page, design.html, { canvasId, ...revision });
        await expect
          .poll(
            () =>
              page.evaluate(
                ({ canvasId, designId, revisionId }) =>
                  window.droidControl?.canvasThumbnailRead(canvasId, designId, revisionId),
                { canvasId, ...revision },
              ),
            { timeout: 20_000, intervals: [100] },
          )
          .not.toBeNull();
        const encoded = await page.evaluate(() => {
          const probe = Reflect.get(window, '__canvasPreviewProbe') as {
            libraryThumbnail: () => Promise<string | null>;
          };
          return probe.libraryThumbnail();
        });
        assert.ok(typeof encoded === 'string' && encoded.length > 0);
        assert.ok(encoded.length <= MAX_LIBRARY_THUMBNAIL_BASE64_LENGTH);
        assert.ok(encoded.startsWith(PNG_BASE64_PREFIX));
        const size = await page.evaluate(async (png) => {
          const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const bounds = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return bounds;
        }, encoded);
        assert.ok(size.width <= 320 && size.height <= 200, JSON.stringify(size));

        // The save carries that picture; the item keeps the frame's own size.
        const saved = await send({
          type: 'canvas.saveLibraryItem',
          mutationId: 'save-hero',
          canvasId,
          revision,
          name: 'Hero',
          thumbnail: encoded,
        });
        assert.ok(saved.kind === 'libraryItem');
        assert.deepEqual(
          { width: saved.item.width, height: saved.item.height },
          { width: 640, height: 400 },
        );
        // An item saved while its frame was never previewed keeps no picture.
        const quiet = await send({
          type: 'canvas.saveLibraryItem',
          mutationId: 'quiet-hero',
          canvasId,
          revision,
          name: 'Quiet hero',
        });
        assert.ok(quiet.kind === 'libraryItem');

        const readSaved = await send({ type: 'canvas.readLibraryThumbnail', itemId: 'save-hero' });
        const readQuiet = await send({ type: 'canvas.readLibraryThumbnail', itemId: 'quiet-hero' });
        assert.ok(readSaved.kind === 'libraryThumbnail' && readSaved.png === encoded);
        assert.ok(readQuiet.kind === 'libraryThumbnail' && readQuiet.png === null);

        // The item owns its picture, so it outlives the canvas it came from.
        const preview = await send({ type: 'canvas.removalPreview', canvasId });
        assert.ok(preview.kind === 'removalPreview');
        await send({
          type: 'canvas.removeCanvas',
          canvasId,
          expectedSequence: preview.preview.sequence,
          expectedAttachedAppSessionIds: preview.preview.attachedAppSessionIds,
        });
        const survived = await send({ type: 'canvas.readLibraryThumbnail', itemId: 'save-hero' });
        assert.ok(survived.kind === 'libraryThumbnail' && survived.png === encoded);
        const listed = await send({ type: 'canvas.listLibraryItems', query: '' });
        assert.ok(listed.kind === 'libraryItems');
        assert.deepEqual(
          new Set(
            listed.items.map((item) => `${item.name}:${String(item.width)}×${String(item.height)}`),
          ),
          new Set(['Hero:640×400', 'Quiet hero:640×400']),
        );
      });

      // The preview probe is a fixed overlay over the top-left corner, so it
      // leaves the document before the Design home's controls are driven.
      await page.evaluate(() => document.getElementById('canvas-zoom-probe')?.remove());

      // The Design home's picker reads the same items and their pictures.
      const switcher = page.getByRole('button', {
        name: /DROIDEX — (Chat|Design)\. Switch product/,
      });
      await expect(switcher).toBeVisible();
      if ((await switcher.getAttribute('aria-label'))?.includes('Chat')) {
        await switcher.click();
        await page.getByRole('menuitemradio', { name: /^Design/ }).click();
      }
      const fromLibrary = page.getByRole('button', { name: 'Start from a saved frame' });
      await expect(fromLibrary).toBeVisible();
      await fromLibrary.click();
      const rows = page.getByRole('list', { name: 'Saved frames' });
      await expect(rows.getByRole('button', { name: /Hero/ })).toBeVisible();
      await expect(rows.locator('img')).toHaveCount(1);
      await expect(rows.locator('img').first()).toHaveAttribute('src', /^data:image\/png;base64,/);
      await expect(rows.getByText('640 × 400 · From a deleted canvas')).toHaveCount(2);
      await expect(rows.getByText('No preview')).toHaveCount(1);

      await rows.getByRole('button', { name: /Hero/ }).click();
      await expect(
        page.getByRole('button', { name: 'Starts from Hero. Choose another saved frame' }),
      ).toBeVisible();
      await expect(rows).toHaveCount(0);
    },
    { realSidecar: true, savedChatIds: [CHAT] },
  );
});
