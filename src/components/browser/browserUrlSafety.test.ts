import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserAddressValue,
  DEFAULT_BROWSER_URL,
  isLocalBrowserUrl,
  isSelfBrowserUrl,
  safeBrowserUrl,
} from './browserUrlSafety';

test('isLocalBrowserUrl accepts HTTP dev servers on exact local hosts', () => {
  for (const url of [
    'http://localhost:3000/',
    'https://127.0.0.1:8443/path',
    'http://0.0.0.0:5173/',
    'http://[::1]:3000/',
  ]) {
    assert.equal(isLocalBrowserUrl(url), true, url);
  }
});

test('isLocalBrowserUrl rejects external hosts, unsupported protocols and invalid URLs', () => {
  for (const url of [
    'https://example.com/',
    'http://localhost.example.invalid/',
    'http://127.0.0.1.example.invalid/',
    'http://0.0.0.0.example.invalid/',
    'http://localhost@example.com/',
    'ftp://localhost:3000/',
    '',
    'not a URL',
    'http://localhost:invalid/',
  ]) {
    assert.equal(isLocalBrowserUrl(url), false, url);
  }
});

test('safeBrowserUrl keeps the host app out of the browser pane', () => {
  assert.equal(
    safeBrowserUrl('http://127.0.0.1:1427/', 'http://127.0.0.1:1427'),
    DEFAULT_BROWSER_URL,
  );
  assert.equal(safeBrowserUrl('127.0.0.1:3000', 'http://127.0.0.1:1427'), 'http://127.0.0.1:3000');
  assert.equal(safeBrowserUrl('localhost:3000', 'http://127.0.0.1:1427'), 'http://localhost:3000');
  // Chromium internal error pages are dropped too.
  assert.equal(
    safeBrowserUrl('chrome-error://chromewebdata/', 'http://127.0.0.1:1427'),
    DEFAULT_BROWSER_URL,
  );
});

test('isSelfBrowserUrl compares origins instead of exact paths', () => {
  assert.equal(isSelfBrowserUrl('http://127.0.0.1:1427/settings', 'http://127.0.0.1:1427'), true);
  assert.equal(isSelfBrowserUrl('http://localhost:1427/settings', 'http://127.0.0.1:1427'), true);
  assert.equal(isSelfBrowserUrl('http://localhost:17777/', 'http://127.0.0.1:1427'), false);
  assert.equal(isSelfBrowserUrl('https://example.com', 'http://127.0.0.1:1427'), false);
});

test('browserAddressValue hides internal blank and error pages', () => {
  assert.equal(browserAddressValue(DEFAULT_BROWSER_URL), '');
  assert.equal(browserAddressValue('chrome-error://chromewebdata/'), '');
  assert.equal(browserAddressValue('https://example.com'), 'https://example.com');
});
