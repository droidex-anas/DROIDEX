import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitiseSvg } from './canvasSvg.js';

const PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

function sanitised(markup: string): string {
  return sanitiseSvg(Buffer.from(markup)).bytes.toString('utf8');
}

test('a hostile SVG keeps its drawing and loses everything that can run or load', () => {
  const hostile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- exported -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 24 24"
  onload="alert(1)" xml:base="https://evil.example/" inkscape:label="Logo">
  <script>alert(1)</script>
  <style>@import url(https://evil.example/x.css);
.a{fill:url(#g)} .b{background:url(https://evil.example/b.png)} .c{fill:\\75rl(https://evil.example)}
@font-face{font-family:x;src:url(https://evil.example/f.woff2)}</style>
  <defs><linearGradient id="g" xlink:href="https://evil.example/g.svg#g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <path class="a" d="M0 0h24v24H0z" onclick="alert(1)" style="fill:red;background-image:url(//evil.example/x)"/>
  <a href="javascript:alert(1)"><circle r="4" fill="url(#g)"/></a>
  <rect width="1" height="1" fill="url(https://evil.example/p.svg#p)" filter="&#x75;rl(https://evil.example/f)"/>
  <animate attributeName="href" values="javascript:alert(1)"/>
  <set attributeName="onclick" to="alert(1)"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x"/></div></foreignObject>
  <g xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></g>
  <use href="https://evil.example/sprite.svg#x"/><use href="data:image/svg+xml;base64,PHN2Zz4=#x"/><use xlink:href="#g"/>
  <image href="https://evil.example/a.png"/><image href="data:image/svg+xml;base64,PHN2Zz4="/>
  <image href="${PNG_DATA}"/>
  <text x="1">&lt;script&gt; &amp; "quotes"</text>
  <iframe src="https://evil.example"/><inkscape:namedview/>
</svg>`;

  assert.equal(
    sanitised(hostile),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  
  <style>.a{fill:url(#g)} .b{} .c{}</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <path class="a" d="M0 0h24v24H0z" style="fill:red"/>
  <g><circle r="4" fill="url(#g)"/></g>
  <rect width="1" height="1"/>
  
  
  
  
  <use/><use/><use href="#g"/>
  <image/><image/>
  <image href="${PNG_DATA}"/>
  <text x="1">&lt;script&gt; &amp; "quotes"</text>
  
</svg>`,
  );
});

test('SVG that would need entities or is not an SVG is refused', () => {
  for (const markup of [
    // Billion laughs: an internal subset can declare entities that expand without bound.
    `<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg">&b;</svg>`,
    `<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><text>&nbsp;</text></svg>`,
    `<html><svg xmlns="http://www.w3.org/2000/svg"/></html>`,
    `<svg xmlns="http://www.w3.org/1999/xhtml"/>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><g></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1" width="2"/>`,
    `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(200)}${'</g>'.repeat(200)}</svg>`,
    'not an image',
  ])
    assert.throws(() => sanitised(markup), { code: 'invalid_input' }, markup.slice(0, 60));
  assert.throws(() => sanitiseSvg(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff])), {
    code: 'invalid_input',
  });
});

test('an SVG measures as an image would show it, within the canvas pixel cap', () => {
  const size = (attributes: string) => {
    const { width, height } = sanitiseSvg(Buffer.from(`<svg ${attributes}/>`));
    return [width, height];
  };
  assert.deepEqual(size('width="120" height="40px"'), [120, 40]);
  assert.deepEqual(size('width="1in" height="72pt"'), [96, 96]);
  assert.deepEqual(size('viewBox="0 0 512 256"'), [512, 256]);
  assert.deepEqual(size('width="100%" viewBox="0,0,30,10"'), [30, 10]);
  assert.deepEqual(size('height="20" viewBox="0 0 30 10"'), [60, 20]);
  assert.deepEqual(size('width="2em"'), [300, 150]);
  assert.deepEqual(size('viewBox="0 0 40000 20000"'), [8192, 4096]);
});

test('sanitising is stable, so the same logo imported twice is one asset', () => {
  const once = sanitiseSvg(
    Buffer.from(
      '\uFEFF<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><svg:path d="M0 0h2v2z" fill="#123"/><svg:title>Mark</svg:title></svg:svg>',
    ),
  );
  assert.equal(
    once.bytes.toString(),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h2v2z" fill="#123"/><title>Mark</title></svg>',
  );
  assert.deepEqual(sanitiseSvg(once.bytes), once);
});
