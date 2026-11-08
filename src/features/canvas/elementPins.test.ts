import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasContextOf, syncFramePins } from './framePins';
import {
  elementLabel,
  elementPins,
  pickElement,
  restoreElementPins,
  syncElementPins,
  unpinElements,
} from './elementPins';
import type { PickedElement } from './pickedElement';
import type { CanvasFrame } from './protocol';

function frame(designId: string, name = `Design ${designId}`): CanvasFrame {
  return {
    designId,
    name,
    rect: { x: 0, y: 0, width: 720, height: 520 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'r1',
    designSystem: { id: 'droidex', version: 2, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    build: { status: 'pending', generation: 1 },
  };
}

function element(designId: string, elementId: string, excerpt?: string): PickedElement {
  return {
    designId,
    revisionId: 'r1',
    elementId,
    instancePath: '0',
    source: { file: 'src/App.tsx', start: 10, end: 40, line: 3 },
    tagName: 'button',
    component: 'PlanCard',
    box: { x: 8, y: 8, width: 120, height: 32 },
    text: excerpt ? { excerpt, box: { x: 10, y: 10, width: 40, height: 14 } } : null,
  };
}

const picked = (appSessionId: string) =>
  elementPins(appSessionId).map((pin) => pin.element.elementId + (pin.element.text ? '+text' : ''));

test('a click picks in place of the picks, and a shift-click adds or takes one off', () => {
  pickElement('chat-p', 'cv_1', frame('d1'), element('d1', 'e1'), false);
  pickElement('chat-p', 'cv_1', frame('d1'), element('d1', 'e2'), false);
  assert.deepEqual(picked('chat-p'), ['e2']);

  pickElement('chat-p', 'cv_1', frame('d2'), element('d2', 'e3'), true);
  // The same element's text is a pick of its own.
  pickElement('chat-p', 'cv_1', frame('d1'), element('d1', 'e2', 'Start free'), true);
  assert.deepEqual(picked('chat-p'), ['e2', 'e3', 'e2+text']);

  pickElement('chat-p', 'cv_1', frame('d2'), element('d2', 'e3'), true);
  assert.deepEqual(picked('chat-p'), ['e2', 'e2+text']);
  // One request points at one canvas, so a pick on another starts over.
  pickElement('chat-p', 'cv_2', frame('d9'), element('d9', 'e9'), true);
  assert.deepEqual(picked('chat-p'), ['e9']);
  assert.equal(elementPins('chat-other').length, 0);
  unpinElements('chat-p');
  assert.equal(elementPins('chat-p').length, 0);
});

test('picks follow the attached canvas and go out as the turn’s element references', () => {
  pickElement('chat-s', 'cv_1', frame('d1'), element('d1', 'e1'), false);
  pickElement('chat-s', 'cv_1', frame('d2'), element('d2', 'e2'), true);
  const sending = elementPins('chat-s');

  assert.deepEqual(canvasContextOf([], null, sending)?.elements, [
    { designId: 'd1', revisionId: 'r1', elementId: 'e1', instancePath: '0' },
    { designId: 'd2', revisionId: 'r1', elementId: 'e2', instancePath: '0' },
  ]);

  // d1 was renamed and d2 deleted.
  syncElementPins('chat-s', { canvasId: 'cv_1', sequence: 2, frames: [frame('d1', 'Pricing')] });
  assert.deepEqual(
    elementPins('chat-s').map((pin) => [pin.element.elementId, pin.frameName]),
    [['e1', 'Pricing']],
  );
  const synced = elementPins('chat-s');
  syncElementPins('chat-s', { canvasId: 'cv_1', sequence: 3, frames: [frame('d1', 'Pricing')] });
  assert.equal(elementPins('chat-s'), synced);

  // An edited queued prompt brings its picks back once, as the shown board has them.
  const closePane = syncFramePins('chat-s', {
    canvasId: 'cv_1',
    sequence: 3,
    frames: [frame('d1', 'Pricing')],
  });
  unpinElements('chat-s', synced);
  restoreElementPins('chat-s', sending);
  restoreElementPins('chat-s', sending);
  assert.deepEqual(picked('chat-s'), ['e1']);
  closePane();

  // A chat that moved to another canvas drops the old canvas's picks.
  syncElementPins('chat-s', { canvasId: 'cv_2', sequence: 1, frames: [frame('d1')] });
  assert.equal(elementPins('chat-s').length, 0);
});

test('a rebuilt frame drops the picks made in its earlier revision', () => {
  pickElement('chat-r', 'cv_1', frame('d1'), element('d1', 'e1'), false);
  const queued = elementPins('chat-r');
  const rebuilt = { canvasId: 'cv_1', sequence: 2, frames: [{ ...frame('d1'), revisionId: 'r2' }] };

  syncElementPins('chat-r', rebuilt);
  assert.equal(elementPins('chat-r').length, 0);
  // Nor does an edited queued prompt bring them back.
  const closePane = syncFramePins('chat-r', rebuilt);
  restoreElementPins('chat-r', queued);
  assert.equal(elementPins('chat-r').length, 0);
  // With the pane closed nothing can confirm a pick's revision, so none come back.
  closePane();
  restoreElementPins('chat-r', queued);
  assert.equal(elementPins('chat-r').length, 0);
});

test('a chip label drops the frame, then the middle of the words, then of the name, to fit', () => {
  const pin = (frameName: string, excerpt?: string, component = 'PlanCard') => ({
    canvasId: 'cv_1',
    frameName,
    frameWidth: 720,
    element: { ...element('d1', 'e1', excerpt), component },
  });
  assert.equal(elementLabel(pin('Hero')), 'PlanCard in Hero · App.tsx:3');
  assert.equal(elementLabel(pin('Pricing', 'For trying things')), 'PlanCard · “For trying things”');
  assert.equal(
    elementLabel(pin('Pricing', 'Everything a growing team needs to ship')),
    'PlanCard · “Everythi… to ship”',
  );
  const long = 'SubscriptionBillingManagementPlanCard';
  assert.equal(elementLabel(pin('Pricing', undefined, long)), 'Subscript…PlanCard · App.tsx:3');
  assert.equal(
    elementLabel(pin('Pricing', 'Everything a growing team needs to ship', long)),
    'Subscri…lanCard · “Every…ship”',
  );
});
