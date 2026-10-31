import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseDesignSystem,
  AUTO_DESIGN_SYSTEM,
  designSystemChoice,
  followLatest,
  forgetDesignSystem,
  NEW_CANVAS_KEY,
  oweCreatedCanvasChoice,
  recentDesignSystems,
  settleCreatedCanvasChoice,
  type DesignSystemChoice,
} from './designSystemChoices';
import { canvasContextOf, type FramePin } from './framePins';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  },
});

const ocean: DesignSystemChoice = {
  ref: { id: 'kit_ocean', version: 3, mode: 'dark' },
  name: 'Ocean',
};
const linen: DesignSystemChoice = {
  ref: { id: 'kit_linen', version: 1, mode: 'light' },
  name: 'Linen',
};

function onCanvas(key: string) {
  return { designSystem: designSystemChoice(key)?.ref ?? null, imageAssetIds: [] };
}

test('a canvas runs under Auto until the user picks a kit, and returns to it on removal', () => {
  assert.equal(designSystemChoice('cv_1'), null);
  assert.deepEqual(canvasContextOf([], onCanvas('cv_1'))?.designSystem, AUTO_DESIGN_SYSTEM.ref);

  chooseDesignSystem('cv_1', ocean);
  assert.deepEqual(canvasContextOf([], onCanvas('cv_1'))?.designSystem, ocean.ref);
  assert.equal(designSystemChoice('cv_2'), null);
  // The choice outlives the window: it is what the next one reads back.
  assert.deepEqual(JSON.parse(stored.get('droidex.canvasDesignSystems') ?? '{}'), {
    cv_1: ocean,
  });

  chooseDesignSystem('cv_1', null);
  assert.equal(designSystemChoice('cv_1'), null);
  assert.deepEqual(canvasContextOf([], onCanvas('cv_1'))?.designSystem, AUTO_DESIGN_SYSTEM.ref);
});

test('an explicit choice outranks the pinned frames’ own kit, and images travel by asset ID', () => {
  const pin: FramePin = {
    canvasId: 'cv_3',
    designId: 'd1',
    revisionId: 'r1',
    name: 'Pricing',
    size: '720 × 520',
    designSystem: linen.ref,
  };
  assert.deepEqual(canvasContextOf([pin], onCanvas('cv_3'))?.designSystem, linen.ref);

  chooseDesignSystem('cv_3', ocean);
  const assetId = 'a'.repeat(64);
  assert.deepEqual(canvasContextOf([pin], { ...onCanvas('cv_3'), imageAssetIds: [assetId] }), {
    designs: [{ designId: 'd1', revisionId: 'r1' }],
    elements: [],
    designSystem: ocean.ref,
    images: [{ assetId }],
  });
  // Off a canvas with nothing pinned, a send carries no context at all.
  assert.equal(canvasContextOf([], null), undefined);
  chooseDesignSystem('cv_3', null);
});

test('the canvas a Design home send makes keeps the kit that send was pinned to', () => {
  chooseDesignSystem(NEW_CANVAS_KEY, ocean);
  oweCreatedCanvasChoice('ref-1');
  // The user moves the home on before the canvas exists.
  chooseDesignSystem(NEW_CANVAS_KEY, linen);

  settleCreatedCanvasChoice('ref-1', 'cv_made');
  assert.deepEqual(designSystemChoice('cv_made'), ocean);
  // Settling is once: a replayed bootstrap does not overwrite a later choice.
  chooseDesignSystem('cv_made', linen);
  settleCreatedCanvasChoice('ref-1', 'cv_made');
  assert.deepEqual(designSystemChoice('cv_made'), linen);

  chooseDesignSystem(NEW_CANVAS_KEY, null);
  oweCreatedCanvasChoice('ref-2');
  settleCreatedCanvasChoice('ref-2', 'cv_plain');
  assert.equal(designSystemChoice('cv_plain'), null);
});

test('choices follow their kit’s latest version, and recent names each kit once, newest first', () => {
  chooseDesignSystem('cv_made', null);
  chooseDesignSystem('cv_a', ocean);
  chooseDesignSystem('cv_b', linen);
  chooseDesignSystem('cv_c', ocean);
  chooseDesignSystem('cv_d', AUTO_DESIGN_SYSTEM);
  assert.deepEqual(
    recentDesignSystems().map((kit) => kit.name),
    ['Ocean', 'Linen'],
  );

  const swatch = { surface: '#fff', accent: '#000' };
  followLatest([
    {
      ...ocean.ref,
      version: 4,
      name: 'Deep ocean',
      kind: 'user',
      swatches: { light: swatch, dark: swatch },
    },
  ]);
  assert.deepEqual(designSystemChoice('cv_a'), {
    ref: { id: 'kit_ocean', version: 4, mode: 'dark' },
    name: 'Deep ocean',
  });
  assert.deepEqual(designSystemChoice('cv_b'), linen);
  // Following keeps each canvas's place in the recent order.
  assert.deepEqual(
    recentDesignSystems(1).map((kit) => kit.name),
    ['Deep ocean'],
  );
});

test('deleting a kit returns the canvases that chose it to Auto, and Undo gives them back', () => {
  chooseDesignSystem('cv_e', linen);
  chooseDesignSystem('cv_f', linen);
  const deleted = forgetDesignSystem('kit_linen');
  assert.equal(designSystemChoice('cv_e'), null);
  assert.equal(designSystemChoice('cv_f'), null);

  // A canvas the user moved on meanwhile keeps its new choice.
  chooseDesignSystem('cv_f', ocean);
  deleted.restore();
  assert.deepEqual(designSystemChoice('cv_e'), linen);
  assert.deepEqual(designSystemChoice('cv_f'), ocean);
});
