import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserUrl } from './browserUrl.js';

test('normalizeBrowserUrl keeps explicit URLs and makes bare domains and localhost loadable', () => {
  for (const [input, expected] of [
    ['https://example.com', 'https://example.com'],
    ['http://127.0.0.1:1420/', 'http://127.0.0.1:1420/'],
    ['about:blank', 'about:blank'],
    ['skeina.tech', 'https://skeina.tech'],
    ['localhost:1420', 'http://localhost:1420'],
    ['//example.com/path', 'https://example.com/path'],
    ['::1:8080/dev', 'http://[::1]:8080/dev'],
  ]) {
    assert.equal(normalizeBrowserUrl(input), expected, input);
  }
});
