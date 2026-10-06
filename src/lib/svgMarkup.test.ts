import assert from 'node:assert/strict';
import test from 'node:test';
import { fitSvgMarkup } from './svgMarkup';

test('the SVG root owns its namespace and scales while child shapes keep their size', () => {
  assert.equal(
    fitSvgMarkup(
      '<svg width="400" height="200px" viewBox="0 0 4 2"><rect width="10" height="10"/></svg>',
    ),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 4 2"><rect width="10" height="10"/></svg>',
  );
  assert.match(
    fitSvgMarkup(
      '<svg viewBox="0 0 4 2"><foreignObject width="4" height="2"><div xmlns="http://www.w3.org/1999/xhtml">Hello</div></foreignObject></svg>',
    ),
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
  );
  const spacedNamespace = '<svg xmlns = "http://www.w3.org/2000/svg" viewBox="0 0 4 2"></svg>';
  assert.equal(fitSvgMarkup(spacedNamespace), spacedNamespace);
});
