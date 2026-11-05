import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESIGN_CANVAS_MCP_INSTRUCTIONS,
  DESIGN_SESSION_GUIDANCE,
} from './designSessionGuidance.js';
import { kitGuidance } from './designSystemDocument.js';
import { AUTO_DESIGN_SYSTEM } from './presets/auto.js';

test('every copy of the Auto rule puts the request, and a wish to explore, before the project and the canvas', () => {
  const autoBrief = kitGuidance(AUTO_DESIGN_SYSTEM.name, AUTO_DESIGN_SYSTEM.sections);
  for (const copy of [DESIGN_SESSION_GUIDANCE, DESIGN_CANVAS_MCP_INSTRUCTIONS, autoBrief])
    assert.match(
      copy,
      /style from[^.]*request[^.]*wish to explore outranks[^.]*project[^.]*frames/,
    );
});

test('project and kit first is a default that a prompt asking to explore sets aside', () => {
  for (const copy of [DESIGN_SESSION_GUIDANCE, DESIGN_CANVAS_MCP_INSTRUCTIONS])
    assert.match(
      copy,
      /Project and kit first is the default[^.]*[.;] When the prompt asks to explore[^.]*the visual direction is free/i,
    );
});

test('the Design brief and its MCP instructions stay within what every turn can afford', () => {
  // Both ride every Design turn, so each paragraph added is paid for on every request.
  assert.ok(Buffer.byteLength(DESIGN_SESSION_GUIDANCE) <= 13 * 1024);
  assert.ok(Buffer.byteLength(DESIGN_CANVAS_MCP_INSTRUCTIONS) <= 5.5 * 1024);
});
