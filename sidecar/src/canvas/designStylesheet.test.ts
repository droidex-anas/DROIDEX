import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  canvasRuntime,
  ownedCanvasRuntimeDir,
  startCanvasRuntime,
  stopCanvasRuntime,
} from './canvasRuntime.js';
import { buildDesignStylesheet } from './designStylesheet.js';

after(stopCanvasRuntime);

test('an element written with hidden stays hidden over a display utility', async () => {
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const files = {
    'main.tsx': 'export default () => <aside hidden className="flex">Side</aside>;\n',
  };
  const built = await buildDesignStylesheet(files, { files: {}, sections: [] });
  assert.ok(built.ok);
  const display = new Map<string, string>();
  canvasRuntime()
    .postcss.parse(built.css)
    .walkDecls('display', (declaration) => {
      if (declaration.parent?.type === 'rule')
        display.set(
          declaration.parent.selector,
          `${declaration.value}${declaration.important ? ' !important' : ''}`,
        );
    });
  assert.equal(display.get('[hidden]:where(:not([hidden="until-found"]))'), 'none !important');
  assert.equal(display.get('.flex'), 'flex');
});
