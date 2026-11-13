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

test('the hidden class comes after every plain display utility, so it wins on the same element', async () => {
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const displays = ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'table'];
  const files = {
    'main.tsx': `export default () => <main className="hidden ${displays.join(' ')}" />;\n`,
  };
  const built = await buildDesignStylesheet(files, { files: {}, sections: [] });
  assert.ok(built.ok);
  const order: string[] = [];
  canvasRuntime()
    .postcss.parse(built.css)
    .walkRules((rule) => {
      if (rule.parent?.type === 'root') order.push(rule.selector);
    });
  const hidden = order.indexOf('.hidden');
  for (const display of displays) {
    const at = order.indexOf(`.${display}`);
    assert.ok(at !== -1 && at < hidden, display);
  }
});
