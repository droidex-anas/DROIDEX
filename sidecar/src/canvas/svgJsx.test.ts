import assert from 'node:assert/strict';
import test from 'node:test';
import { compileInput } from '../testing/canvasCompilerSupport.js';
import { sanitiseSvg } from './canvasSvg.js';
import { CompilerWorker } from './compiler.js';
import type { OwnedAsset } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import { svgFrameSource } from './svgJsx.js';

const DESIGN_ID = '1234abcd-5678-4000-8000-000000000000';

function drawn(markup: string) {
  const { bytes, width, height } = sanitiseSvg(Buffer.from(markup));
  const asset: OwnedAsset = {
    assetId: 'a'.repeat(64),
    mediaType: 'image/svg+xml',
    byteLength: bytes.length,
    width,
    height,
  };
  return svgFrameSource(asset, bytes, DESIGN_ID);
}

const FIGMA = `<svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="120" height="80" fill="url(#paint0)"/>
<path d="M10 10H110V70H10Z" stroke="#1E1E1E" stroke-width="2" style="mix-blend-mode:multiply;--tone:1"/>
<text x="10" y="40" xml:space="preserve">Save {50%} &amp; more
  <tspan>now</tspan></text>
<defs><linearGradient id="paint0"><stop stop-color="#F00"/></linearGradient></defs>
<use href="#paint0"/>
</svg>`;

test('an SVG becomes a frame whose root is the SVG, in React names, and it compiles', async (t) => {
  const { mainTsx, svgAsImage } = drawn(FIGMA);
  assert.equal(svgAsImage, null);
  assert.equal(
    mainTsx,
    `export default function Vector() {
  return (
    <svg className="block" width="120" height="80" viewBox="0 0 120 80" fill="none">
      <rect width="120" height="80" fill="url(#v1234abcd-paint0)" />
      <path d="M10 10H110V70H10Z" stroke="#1E1E1E" strokeWidth="2" style={{ mixBlendMode: "multiply", "--tone": "1" }} />
      <text x="10" y="40" xmlSpace="preserve">Save &#123;50%&#125; &amp; more <tspan>now</tspan></text>
      <defs>
        <linearGradient id="v1234abcd-paint0">
          <stop stopColor="#F00" />
        </linearGradient>
      </defs>
      <use href="#v1234abcd-paint0" />
    </svg>
  );
}
`,
  );

  const compiler = new CompilerWorker();
  t.after(() => compiler.terminate());
  const design = await compiler.compile(
    compileInput({ 'main.tsx': mainTsx }),
    new AbortController().signal,
  );
  assert.deepEqual(design.diagnostics, []);
});

test('class rules are written onto their elements, and the classes go', () => {
  const { mainTsx, svgAsImage } = drawn(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><defs><style>.a{fill:#231f20}.b,.c{stroke:#fff;stroke-width:2px}</style></defs><circle class="a b" fill="blue" style="fill:red" r="20"/><rect class="c" width="5" height="5"/></svg>`,
  );
  assert.equal(svgAsImage, null);
  // A rule beats the attribute, and `style` still beats the rule.
  assert.match(
    mainTsx,
    /<circle fill="#231f20" style=\{\{ fill: "red" \}\} r="20" stroke="#fff" strokeWidth="2px" \/>/,
  );
  assert.match(mainTsx, /<rect width="5" height="5" stroke="#fff" strokeWidth="2px" \/>/);
  assert.doesNotMatch(mainTsx, / class=|<style/);

  // Of two rules, the later one wins, whatever order the classes are named in.
  const later = drawn(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><style>.a{fill:red}.b{fill:blue}</style><rect class="b a" width="5" height="5"/></svg>`,
  );
  assert.match(later.mainTsx, /<rect width="5" height="5" fill="blue" \/>/);
});

test('an SVG the frame cannot draw as JSX is drawn as its owned image', () => {
  for (const css of [
    'svg path{fill:red}',
    '.a{transform:rotate(4deg)}',
    '.a{fill:red!important}',
  ]) {
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>${css}</style><path class="a" d="M0 0"/></svg>`;
    assert.deepEqual(drawn(markup), {
      mainTsx: `export default function Vector() {
  return (
    <img className="block" src="canvas-asset:${'a'.repeat(64)}" width="10" height="10" alt="" />
  );
}
`,
      svgAsImage: 'stylesheet',
    });
  }
  const crowded = `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(CANVAS_LIMITS.maxSourceElements)}</svg>`;
  assert.equal(drawn(crowded).svgAsImage, 'too_large');
  const long = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${'M0 0'.repeat(CANVAS_LIMITS.maxFileBytes / 4)}"/></svg>`;
  assert.equal(drawn(long).svgAsImage, 'too_large');
});
