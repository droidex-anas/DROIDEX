import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import {
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
} from '../../src/features/canvas/previewDocument';
import { askGuest, mountPreviewGuest } from './canvasPreviewHost';
import { withCanvasBridge, withCanvasHost } from './canvasSmoke';

export async function runCanvasAssetsSmoke(): Promise<void> {
  await withCanvasHost(
    async (app, page) => {
      const profile = await app.evaluate(({ app }) => app.getPath('userData'));
      const fontRoot = path.join(profile, 'canvas-fonts');
      const inter = JSON.parse(
        await readFile('sidecar/src/canvas/presets/fonts/inter.json', 'utf8'),
      ) as { css: string };
      const encodedFont = /url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/.exec(inter.css)?.[1];
      assert.ok(encodedFont);
      const font = Buffer.from(encodedFont, 'base64');
      const fontId = createHash('sha256').update(font).digest('hex');
      const kitRoot = path.join(profile, 'canvases', 'design-systems', 'asset-smoke-kit');
      await mkdir(kitRoot, { recursive: true });
      await writeFile(
        path.join(kitRoot, '1.json'),
        JSON.stringify({
          id: 'asset-smoke-kit',
          version: 1,
          name: 'Offline asset smoke',
          modes: { light: {}, dark: {} },
          files: {
            'index.tsx': 'export const assetSmokeKit = true;',
            'font.css': inter.css,
          },
          guidance: '',
          examples: {},
        }),
      );

      await withCanvasBridge(page, async (send) => {
        const created = await send({
          type: 'canvas.createCanvas',
          appSessionId: 'asset-smoke-chat',
        });
        assert.ok(created.kind === 'attachment' && created.canvasId);
        const canvasId = created.canvasId;
        const chosen = path.join(profile, 'chosen.png');
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
          'base64',
        );
        await writeFile(chosen, png);
        await page.evaluate(() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.id = 'canvas-image-input';
          document.body.append(input);
        });
        await page.locator('#canvas-image-input').setInputFiles(chosen);
        await page.evaluate(async (id) => {
          const input = document.getElementById('canvas-image-input') as HTMLInputElement;
          const file = input.files?.[0];
          if (!file) throw new Error('The image was not selected');
          return window.droidControl!.canvasDropImage(id, file);
        }, canvasId);
        await unlink(chosen);
        const missing = await page.evaluate(async (id) => {
          const file = (document.getElementById('canvas-image-input') as HTMLInputElement)
            .files![0]!;
          try {
            await window.droidControl!.canvasDropImage(id, file);
            return null;
          } catch (error) {
            return {
              code: Reflect.get(error as object, 'code'),
              message: String(Reflect.get(error as object, 'message')),
            };
          }
        }, canvasId);
        assert.equal(missing?.code, 'invalid_input');
        assert.equal(missing.message.includes(chosen), false);

        const listed = await send({ type: 'canvas.listAssets', canvasId });
        assert.ok(listed.kind === 'assets');
        assert.equal(listed.assets.length, 1);
        const [owned] = listed.assets;
        assert.ok(owned);

        for (const name of ['mismatch.jpg', 'mismatch.svg']) {
          const mismatch = path.join(profile, name);
          await writeFile(mismatch, png);
          await page.locator('#canvas-image-input').setInputFiles(mismatch);
          const refusal = await page.evaluate(async (id) => {
            const file = (document.getElementById('canvas-image-input') as HTMLInputElement)
              .files![0]!;
            try {
              await window.droidControl!.canvasDropImage(id, file);
              return null;
            } catch (error) {
              return {
                code: Reflect.get(error as object, 'code'),
                message: String(Reflect.get(error as object, 'message')),
              };
            }
          }, canvasId);
          assert.equal(refusal?.code, 'invalid_input');
          assert.equal(refusal.message.includes(mismatch), false);
        }

        const jpeg = Buffer.from(
          await app.evaluate(
            ({ nativeImage }, encoded) =>
              nativeImage
                .createFromBuffer(Buffer.from(encoded, 'base64'))
                .toJPEG(90)
                .toString('base64'),
            png.toString('base64'),
          ),
          'base64',
        );
        const webp = Buffer.from(
          'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=',
          'base64',
        );
        for (const [name, bytes, mediaType] of [
          ['positive.jpg', jpeg, 'image/jpeg'],
          ['positive.webp', webp, 'image/webp'],
        ] as const) {
          const selected = path.join(profile, name);
          await writeFile(selected, bytes);
          await page.locator('#canvas-image-input').setInputFiles(selected);
          const imported = await page.evaluate(async (id) => {
            const file = (document.getElementById('canvas-image-input') as HTMLInputElement)
              .files![0]!;
            try {
              return { ok: true, asset: await window.droidControl!.canvasDropImage(id, file) };
            } catch (error) {
              return {
                ok: false,
                code: Reflect.get(error as object, 'code'),
                message: String(Reflect.get(error as object, 'message')),
              };
            }
          }, canvasId);
          assert.equal(imported.ok, true, `${name}: ${JSON.stringify(imported)}`);
          const asset = imported.asset;
          assert.ok(asset);
          assert.equal(asset.mediaType, mediaType);
          assert.equal(asset.width, 1);
          assert.equal(asset.height, 1);
        }

        await writeFile(chosen, png);
        await page.locator('#canvas-image-input').setInputFiles(chosen);
        const failedCanvas = await send({
          type: 'canvas.createCanvas',
          appSessionId: 'asset-storage-failure-chat',
        });
        assert.ok(failedCanvas.kind === 'attachment' && failedCanvas.canvasId);
        await symlink(profile, path.join(profile, 'canvases', failedCanvas.canvasId, 'assets'));
        const storageFailure = await page.evaluate(async (id) => {
          const file = (document.getElementById('canvas-image-input') as HTMLInputElement)
            .files![0]!;
          try {
            await window.droidControl!.canvasDropImage(id, file);
            return null;
          } catch (error) {
            return {
              code: Reflect.get(error as object, 'code'),
              message: String(Reflect.get(error as object, 'message')),
            };
          }
        }, failedCanvas.canvasId);
        assert.equal(storageFailure?.code, 'storage_failed');
        assert.equal(storageFailure.message.includes(chosen), false);
        const added = await send({
          type: 'canvas.create',
          canvasId,
          appSessionId: 'asset-smoke-chat',
          input: {
            mutationId: 'asset-frame',
            frames: [
              {
                name: 'Owned assets',
                width: 320,
                height: 240,
                designSystem: { id: 'asset-smoke-kit', version: 1, mode: 'light' },
              },
            ],
          },
        });
        assert.ok(added.kind === 'created');
        const [frame] = added.created.frames;
        assert.ok(frame);
        const written = await send({
          type: 'canvas.write',
          canvasId,
          appSessionId: 'asset-smoke-chat',
          input: {
            mutationId: 'asset-source',
            designId: frame.designId,
            expectedRevisionId: null,
            files: {
              'main.tsx': `export default function Assets() { return <div style={{fontFamily:'Inter, sans-serif'}}><img id="owned-image" src="canvas-asset:${owned.assetId}" /><span id="fonted">Offline font</span></div> }`,
            },
            deletedPaths: [],
          },
        });
        assert.ok(written.kind === 'written');
        let html = '';
        await expect
          .poll(
            async () => {
              const reply = await send({
                type: 'canvas.readArtifact',
                canvasId,
                designId: frame.designId,
                revisionId: written.receipt.revisionId,
              });
              if (reply.kind === 'artifact') html = reply.artifact?.html ?? '';
              return html.length > 0;
            },
            { timeout: 30_000, intervals: [200] },
          )
          .toBe(true);
        assert.ok(html.includes('droidex-canvas-preview://preview/asset/'));
        assert.ok(html.includes('droidex-canvas-preview://preview/font/'));
        assert.equal(html.includes('data:font/woff2;base64,'), false);
        assert.deepEqual(await readFile(path.join(fontRoot, fontId)), font);
        const imageUrl =
          /droidex-canvas-preview:\/\/preview\/asset\/[A-Za-z0-9_-]+\/[0-9a-f]{64}\?sig=[0-9a-f]{64}/.exec(
            html,
          )?.[0];
        assert.ok(imageUrl);
        const fontUrl = `droidex-canvas-preview://preview/font/${fontId}`;
        assert.deepEqual(
          await app.evaluate(
            async ({ net }, urls) => {
              const [image, font] = await Promise.all(urls.map((url) => net.fetch(url)));
              return [image.status, font.status];
            },
            [imageUrl, fontUrl],
          ),
          [404, 404],
        );

        await app.evaluate(({ session }) => {
          const statuses: { guestId: number | undefined; url: string; status: number }[] = [];
          Reflect.set(globalThis, 'canvasAssetStatuses', statuses);
          session
            .fromPartition('droidex-canvas-preview')
            .webRequest.onCompleted({ urls: ['droidex-canvas-preview://preview/*'] }, (details) => {
              statuses.push({
                guestId: details.webContentsId,
                url: details.url,
                status: details.statusCode,
              });
            });
        });

        const guestId = await mountPreviewGuest(page);
        assert.equal(
          await page.evaluate(
            ([id, canvas]) => window.droidControl!.canvasPreviewBind(id, canvas),
            [guestId, canvasId] as const,
          ),
          true,
        );
        const instance = {
          nonce: previewNonce(),
          designId: frame.designId,
          revisionId: written.receipt.revisionId,
          generation: 1,
        };
        assert.equal(await askGuest(page, previewStartScript(instance, html)), PREVIEW_STARTED);
        await expect
          .poll(
            () =>
              app.evaluate(async ({ webContents }, id) => {
                const frame = webContents.fromId(id)?.mainFrame.frames[0];
                if (!frame) return { image: false, font: false };
                return frame.executeJavaScript(`(async () => {
                  const image = document.getElementById('owned-image');
                  if (!image) return { image: false, font: false };
                  try {
                    const fonts = await document.fonts.load('16px "Inter"');
                    return { image: image.complete && image.naturalWidth === 1, font: fonts.length === 1 && fonts[0].status === 'loaded' };
                  } catch (error) {
                    return { image: image.complete && image.naturalWidth === 1, font: String(error) };
                  }
                })()`);
              }, guestId),
            { timeout: 20_000, intervals: [200] },
          )
          .toEqual({ image: true, font: true });

        await page.evaluate(() => document.getElementById('canvas-preview-guest')?.remove());
        const missingFontUrl = `droidex-canvas-preview://preview/font/${'f'.repeat(64)}`;
        const fallbackGuest = await mountPreviewGuest(page);
        assert.equal(
          await page.evaluate(
            ([id, canvas]) => window.droidControl!.canvasPreviewBind(id, canvas),
            [fallbackGuest, canvasId] as const,
          ),
          true,
        );
        assert.equal(
          await askGuest(
            page,
            previewStartScript(
              { ...instance, nonce: previewNonce() },
              html.replace(fontUrl, missingFontUrl),
            ),
          ),
          PREVIEW_STARTED,
        );
        await expect
          .poll(() =>
            app.evaluate(({ webContents }, id) => {
              const frame = webContents.fromId(id)?.mainFrame.frames[0];
              if (!frame) return null;
              return frame.executeJavaScript(`(async () => {
                const text = document.getElementById('fonted');
                if (!text) return null;
                try { await document.fonts.load('16px "Inter"'); } catch {}
                const face = [...document.fonts].find((font) => font.family === 'Inter');
                return { text: text.textContent, fallback: getComputedStyle(text).fontFamily.includes('sans-serif'), status: face?.status };
              })()`);
            }, fallbackGuest),
          )
          .toEqual({ text: 'Offline font', fallback: true, status: 'error' });

        await page.evaluate(() => document.getElementById('canvas-preview-guest')?.remove());
        const second = await send({
          type: 'canvas.createCanvas',
          appSessionId: 'asset-replay-chat',
        });
        assert.ok(second.kind === 'attachment' && second.canvasId);
        const secondGuest = await mountPreviewGuest(page);
        assert.equal(
          await page.evaluate(
            ([id, canvas]) => window.droidControl!.canvasPreviewBind(id, canvas),
            [secondGuest, second.canvasId] as const,
          ),
          true,
        );
        assert.equal(
          await askGuest(page, previewStartScript({ ...instance, nonce: previewNonce() }, html)),
          PREVIEW_STARTED,
        );
        await expect
          .poll(() =>
            app.evaluate(({ webContents }, id) => {
              const frame = webContents.fromId(id)?.mainFrame.frames[0];
              if (!frame) return null;
              return frame.executeJavaScript(
                `document.getElementById('owned-image')?.complete ? document.getElementById('owned-image').naturalWidth : null`,
              );
            }, secondGuest),
          )
          .toBe(0);
        await expect
          .poll(() =>
            app.evaluate((_, id) => {
              const statuses = Reflect.get(globalThis, 'canvasAssetStatuses') as Array<{
                guestId: number;
                url: string;
                status: number;
              }>;
              return statuses.some(
                (entry) =>
                  entry.guestId === id &&
                  entry.url === 'droidex-canvas-preview://preview/not-found' &&
                  entry.status === 404,
              );
            }, secondGuest),
          )
          .toBe(true);

        await page.evaluate(() => document.getElementById('canvas-preview-guest')?.remove());
        const unboundGuest = await mountPreviewGuest(page);
        assert.equal(
          await askGuest(page, previewStartScript({ ...instance, nonce: previewNonce() }, html)),
          PREVIEW_STARTED,
        );
        await expect
          .poll(() =>
            app.evaluate(({ webContents }, id) => {
              const frame = webContents.fromId(id)?.mainFrame.frames[0];
              if (!frame) return null;
              return frame.executeJavaScript(
                `document.getElementById('owned-image')?.complete ? document.getElementById('owned-image').naturalWidth : null`,
              );
            }, unboundGuest),
          )
          .toBe(0);
      });
    },
    { realSidecar: true },
  );
}
