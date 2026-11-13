import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceLabel, measureBetween } from './measureDistances';
import type { FrameRect } from './protocol';

function rect(x: number, y: number, width: number, height: number): FrameRect {
  return { x, y, width, height };
}

test('boxes side by side measure the gap from the selection and their offsets on the other axis', () => {
  // The gap runs through the middle of the span both share; the offsets run through the space between.
  assert.deepEqual(measureBetween(rect(0, 0, 100, 100), rect(140, 50, 100, 100)), [
    { axis: 'x', from: 100, to: 140, at: 75 },
    { axis: 'y', from: 0, to: 50, at: 120 },
    { axis: 'y', from: 100, to: 150, at: 120 },
  ]);
  // With the hovered box on the left, the gap still runs where the two meet it.
  assert.deepEqual(measureBetween(rect(140, 50, 100, 100), rect(0, 0, 100, 100)), [
    { axis: 'x', from: 100, to: 140, at: 75 },
    { axis: 'y', from: 0, to: 50, at: 120 },
    { axis: 'y', from: 100, to: 150, at: 120 },
  ]);
});

test('boxes apart on both axes measure both gaps from the middle of the selection', () => {
  assert.deepEqual(measureBetween(rect(0, 0, 100, 60), rect(130, 100, 80, 80)), [
    { axis: 'x', from: 100, to: 130, at: 30 },
    { axis: 'y', from: 60, to: 100, at: 50 },
  ]);
});

test('overlapping boxes measure each selection edge to the nearer edge of the hovered box', () => {
  // Each line runs through the middle of the span the two share across it.
  assert.deepEqual(measureBetween(rect(0, 0, 100, 100), rect(90, 20, 60, 100)), [
    { axis: 'x', from: 0, to: 90, at: 60 },
    { axis: 'x', from: 90, to: 100, at: 60 },
    { axis: 'y', from: 0, to: 20, at: 95 },
    { axis: 'y', from: 100, to: 120, at: 95 },
  ]);
});

test('a box inside another measures its four insets, whichever of the two is selected', () => {
  const outer = rect(0, 0, 200, 100);
  const inner = rect(16, 24, 160, 52);
  const insets = [
    { axis: 'x', from: 0, to: 16, at: 50 },
    { axis: 'x', from: 176, to: 200, at: 50 },
    { axis: 'y', from: 0, to: 24, at: 96 },
    { axis: 'y', from: 76, to: 100, at: 96 },
  ];
  assert.deepEqual(measureBetween(inner, outer), insets);
  assert.deepEqual(measureBetween(outer, inner), insets);
});

test('a distance that reads 0 is not measured', () => {
  // Touching boxes have no gap, and a shared edge, or one an eighth off, has no inset.
  assert.deepEqual(measureBetween(rect(0, 0, 100, 100), rect(100, 0, 100, 100)), []);
  assert.deepEqual(measureBetween(rect(0, 0, 100, 100), rect(0.125, 0, 60, 40)), [
    { axis: 'x', from: 60.125, to: 100, at: 20 },
    { axis: 'y', from: 40, to: 100, at: 30.125 },
  ]);
  // Touching boxes set apart across still measure that offset.
  assert.deepEqual(measureBetween(rect(0, 0, 100, 100), rect(100, 20, 100, 100)), [
    { axis: 'y', from: 0, to: 20, at: 100 },
    { axis: 'y', from: 100, to: 120, at: 100 },
  ]);
});

test('a distance reads in whole pixels, or a half pixel when rounding would be a quarter off', () => {
  assert.equal(distanceLabel(12), '12');
  assert.equal(distanceLabel(12.2), '12');
  assert.equal(distanceLabel(12.4), '12.5');
  assert.equal(distanceLabel(12.6), '12.5');
  assert.equal(distanceLabel(12.8), '13');
});
