import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESIGN_CANVAS_MCP_INSTRUCTIONS,
  DESIGN_SESSION_GUIDANCE,
} from './designSessionGuidance.js';
import { kitGuidance } from './designSystemDocument.js';
import { AUTO_DESIGN_SYSTEM } from './presets/auto.js';

test('every copy of the Auto rule takes the style from the request, the project, then the canvas', () => {
  const autoBrief = kitGuidance(AUTO_DESIGN_SYSTEM.name, AUTO_DESIGN_SYSTEM.sections);
  for (const copy of [DESIGN_SESSION_GUIDANCE, DESIGN_CANVAS_MCP_INSTRUCTIONS, autoBrief])
    assert.match(copy, /style from[^.]*request[^.]*project[^.]*frames/);
});

test('the Design brief and its MCP instructions stay within what every turn can afford', () => {
  // Both ride every Design turn, so each paragraph added is paid for on every request.
  assert.ok(Buffer.byteLength(DESIGN_SESSION_GUIDANCE) <= 13 * 1024);
  assert.ok(Buffer.byteLength(DESIGN_CANVAS_MCP_INSTRUCTIONS) <= 5.5 * 1024);
});
