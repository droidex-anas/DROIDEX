import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserUrl, redactBrowserUrl } from './browserUrl.js';

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

test('redactBrowserUrl drops credentials, fragments and secret-named parameters', () => {
  assert.equal(
    redactBrowserUrl('https://user:pw@example.com/a?api_key=s3&page=2#tok'),
    'https://example.com/a?api_key=%5Bredacted%5D&page=2',
  );
});

test('redactBrowserUrl redacts a relative URL passed as a parameter', () => {
  assert.equal(
    redactBrowserUrl('https://example.com/login?next=/continue?access_token=secret'),
    'https://example.com/login?next=https%3A%2F%2Fexample.com%2Fcontinue%3Faccess_token%3D%255Bredacted%255D',
  );
});

test('redactBrowserUrl shows only the scheme of a page that is not on the web', () => {
  assert.equal(redactBrowserUrl('file:///Users/anas/notes.html'), 'file:[hidden]');
});
