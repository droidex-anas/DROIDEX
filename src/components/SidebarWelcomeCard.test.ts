import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarWelcomeCard } from './SidebarWelcomeCard';

const render = (onStart = () => undefined, onDismiss = () => undefined) =>
  renderToStaticMarkup(createElement(SidebarWelcomeCard, { onStart, onDismiss }));

test('offers a primary start-a-chat action and a dismiss button, no learn-more link', () => {
  const html = render();
  assert.match(html, /<button[^>]*>.*Start a chat.*<\/button>/s);
  assert.match(html, /aria-label="Dismiss"/);
  assert.doesNotMatch(html, /Learn more/);
});
