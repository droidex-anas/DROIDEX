const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { refuseAgentScheme } = require('./browserNavigationIntent.cjs');

test('agent pointer and keyboard activation refuse executable links and non-http form targets before input', async () => {
  let element;
  const document = {
    get activeElement() {
      return element;
    },
    elementFromPoint: () => element,
  };
  const dbg = {
    sendCommand: async (_method, { expression }) => ({
      result: { value: vm.runInNewContext(expression, { document }) },
    }),
  };
  const link = (href) => ({ closest: (selector) => (selector.startsWith('a[') ? { href } : null) });
  for (const href of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/page']) {
    element = link(href);
    await assert.rejects(refuseAgentScheme(dbg, undefined, { x: 20, y: 30 }), /http\(s\)/);
    await assert.rejects(refuseAgentScheme(dbg), /http\(s\)/);
  }
  element = link('https://site.test/path');
  await refuseAgentScheme(dbg);
  const form = { action: 'https://site.test/post', method: 'post', elements: [] };
  const button = {
    type: 'submit',
    form,
    formAction: 'file:///tmp/page',
    getAttribute: () => null,
    hasAttribute: (name) => name === 'formaction',
  };
  element = { closest: (selector) => (selector.startsWith('button') ? button : null) };
  await assert.rejects(refuseAgentScheme(dbg, undefined, { x: 20, y: 30 }), /http\(s\)/);
  form.elements = [button];
  element = { form, closest: () => null };
  await assert.rejects(refuseAgentScheme(dbg), /http\(s\)/);
});
