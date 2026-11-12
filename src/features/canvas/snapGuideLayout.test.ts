import assert from 'node:assert/strict';
import test from 'node:test';
import { SIZE_ROOM_PX } from './ElementOutlines';
import { layOutGuides } from './snapGuideLayout';

const viewport = { x: 0, y: 0, scale: 1 };
const unmeasured = { width: 0, height: 0 };

test('a distance down from a sized box sits below its size chip, and a short one beside its line', () => {
  const [below, short] = layOutGuides(
    {
      guides: [],
      gaps: [
        { axis: 'y', from: 100, to: 140, at: 50 },
        { axis: 'x', from: 0, to: 5, at: 20 },
      ],
      sizedBottom: 100,
    },
    viewport,
    [unmeasured, unmeasured],
  ).gaps;
  assert.ok(below.pill.top > 100 + SIZE_ROOM_PX);
  assert.equal(below.beside, false);
  assert.equal(short.beside, true);
});
