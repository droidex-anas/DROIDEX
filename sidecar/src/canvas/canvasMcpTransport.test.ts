import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { harness } from '../testing/canvasMcpSupport.js';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';

pinScratchProfile();

// How Droid checks the arguments of a tool its Script tool calls, before it
// sends them: removeAdditional deletes a key while it tries a union branch
// that lacks it.
const droidArgumentCheck = new Ajv({ removeAdditional: true, allErrors: true, useDefaults: true });

async function listedSchemas(url: string): Promise<Map<string, object>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await response.text();
  const payload =
    text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6) ?? text;
  const { tools } = JSON.parse(payload).result as {
    tools: { name: string; inputSchema: object }[];
  };
  return new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
}

test('Droid accepts every branch of a listed union, not only the first', async (t) => {
  const h = await harness(t);
  const config = await h.server.start();
  t.after(() => h.server.close());
  assert.ok('url' in config);
  const schemas = await listedSchemas(config.url);
  const accepts = (name: string, args: Record<string, unknown>) =>
    droidArgumentCheck.validate(schemas.get(name) ?? false, structuredClone(args));

  const save = { scopeId: 'turn:one', operation: 'save', mutationId: 'save-one' };
  assert.equal(accepts('canvas_theme', { ...save, kit: { id: 'acme', from: 'blank' } }), true);
  assert.equal(
    accepts('canvas_theme', {
      ...save,
      kit: { id: 'acme', baseVersion: 1 },
      changes: [{ set: 'note', label: 'Accent', body: 'One primary action per view.' }],
    }),
    true,
  );
  const arrow = { id: 'arrow', color: 'blue', kind: 'line', arrowStart: false, arrowEnd: true };
  assert.equal(
    accepts('canvas_annotate', {
      scopeId: 'turn:one',
      mutationId: 'arrow-one',
      expectedAnnotationsVersion: 0,
      upserts: [
        {
          ...arrow,
          points: [
            { x: 0, y: 0 },
            { x: 9, y: 9 },
          ],
        },
      ],
      deletes: [],
    }),
    true,
  );
});
