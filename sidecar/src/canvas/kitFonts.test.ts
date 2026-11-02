import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, okReply } from '../testing/canvasBridgeSupport.js';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { readDesignSystem } from './designSystems.js';
import { readKitFonts } from './kitFonts.js';

pinScratchProfile();

test("a kit's document gets the WOFF2 faces its stylesheets embed, and none it would fetch", async (t) => {
  const canvas = await harness(t);
  const ref = { id: 'margin', version: 1 };
  await canvas.handle({ type: 'canvas.readKitFonts', requestId: 'req-fonts', ref });
  const reply = okReply(canvas, 'req-fonts');
  assert.ok(reply.kind === 'kitFonts');
  assert.deepEqual(
    reply.faces.map(({ family, style, weight, unicodeRange }) => ({
      family,
      style,
      weight,
      unicodeRange,
    })),
    [
      { family: 'Newsreader', style: 'normal', weight: '200 800', unicodeRange: 'U+0-10FFFF' },
      { family: 'Newsreader', style: 'italic', weight: '200 800', unicodeRange: 'U+0-10FFFF' },
      {
        family: 'Schibsted Grotesk',
        style: 'normal',
        weight: '400 900',
        unicodeRange: 'U+0-10FFFF',
      },
    ],
  );
  const newsreader = reply.faces[0].woff2;
  assert.equal(Buffer.from(newsreader, 'base64').toString('ascii', 0, 4), 'wOF2');

  const notAFont = Buffer.from('not a font').toString('base64');
  const brand = `
    /* @font-face { font-family: Commented; src: url(data:font/woff2;base64,${newsreader}); } */
    @font-face { font-family: Fetched; src: url(https://fonts.example/brand.woff2); }
    @font-face { font-family: Fake; src: url(data:font/woff2;base64,${notAFont}); }
    @font-face { font-family: Padded; src: url(data:font/woff2;base64,${newsreader.slice(0, 8)}=${newsreader.slice(8)}); }
    @font-face { font-family: Quoted; src: url('data:font/woff2;base64,${newsreader}'); }
    @font-face {
      font-family: 'Brand Sans';
      font-weight: 700;
      unicode-range: U+0-7F;
      src: url(https://fonts.example/brand.woff2) format('woff2'),
        url(data:font/woff2;base64,${newsreader}) format('woff2');
    }
  `;
  const kit = await readDesignSystem(ref);
  assert.deepEqual(readKitFonts({ ...kit, files: { ...kit.files, 'fonts.css': brand } }), [
    {
      family: 'Quoted',
      style: 'normal',
      weight: 'normal',
      unicodeRange: 'U+0-10FFFF',
      woff2: newsreader,
    },
    {
      family: 'Brand Sans',
      style: 'normal',
      weight: '700',
      unicodeRange: 'U+0-7F',
      woff2: newsreader,
    },
  ]);
});
