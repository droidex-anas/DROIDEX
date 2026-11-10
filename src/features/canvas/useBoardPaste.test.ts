import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import type { CanvasFrame, CreateFramesInput, CreateFramesResult, OwnedAsset } from './protocol';
import { pastedSvg, placePastedSvg, type PasteBoard } from './useBoardPaste';

let shown: ToastItem[] = [];
const stopWatching = subscribeToasts((toasts) => {
  shown = toasts;
});
afterEach(() => {
  for (const item of shown) dismissToast(item.id);
});
process.on('exit', stopWatching);

function clipboard(files: File[], data: Record<string, string>) {
  return { files, getData: (type: string) => data[type] ?? '' };
}

const FIGMA =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="#0D99FF"/></svg>';

test('a paste carries an SVG as an .svg file or as text whose root is <svg>, and nothing else', async () => {
  const fromText = pastedSvg(clipboard([], { 'text/plain': FIGMA }));
  assert.equal(fromText?.name, 'Pasted SVG');
  assert.equal(await fromText?.markup(), FIGMA);

  const declared = `<?xml version="1.0"?>\n<!-- Generator: Illustrator -->\n<!DOCTYPE svg>\n${FIGMA}`;
  assert.ok(pastedSvg(clipboard([], { 'image/svg+xml': declared })));

  const file = new File([FIGMA], 'Logo mark.svg', { type: '' });
  const fromFile = pastedSvg(
    clipboard([new File(['png'], 'shot.png', { type: 'image/png' }), file], {}),
  );
  assert.equal(fromFile?.name, 'Logo mark');
  assert.equal(await fromFile?.markup(), FIGMA);

  assert.equal(pastedSvg(clipboard([], { 'text/plain': `<div>${FIGMA}</div>` })), null);
  assert.equal(pastedSvg(clipboard([], { 'text/html': FIGMA })), null);
  assert.equal(
    pastedSvg(clipboard([new File(['png'], 'shot.png', { type: 'image/png' })], {})),
    null,
  );
});

const asset: OwnedAsset = {
  assetId: 'ast_logo',
  mime: 'image/svg+xml',
  width: 24,
  height: 24,
  bytes: 160,
  sha256: 'a'.repeat(64),
};

const logoFrame: CanvasFrame = {
  designId: 'dsg_logo',
  name: 'Logo mark',
  rect: { x: 0, y: 0, width: 24, height: 24 },
  layoutVersion: 1,
  manifestVersion: 1,
  revisionId: null,
  designSystem: { id: 'droidex', version: 1, mode: 'light' },
  variantOf: null,
  seededRevisionId: null,
  hidden: false,
  build: { status: 'pending', generation: 1 },
};

function fakeBoard(result: Partial<CreateFramesResult> = {}) {
  let current = true;
  const created: CreateFramesInput[] = [];
  const focused: string[] = [];
  const board: PasteBoard = {
    canvasId: 'cv',
    isCurrent: () => current,
    beside: undefined,
    designSystem: { id: 'droidex', version: 1, mode: 'light' },
    importSvg: async () => asset,
    createFrames: async (input) => {
      created.push(input);
      return { canvasId: 'cv', frames: [logoFrame], ...result };
    },
    focusFrame: (designId) => focused.push(designId),
  };
  return { board, created, focused, leave: () => (current = false) };
}

test('a pasted SVG becomes a frame sized from its asset, and one that must stay an image says why', async () => {
  const svg = { name: 'Logo mark', markup: async () => FIGMA };
  const inline = fakeBoard();
  await placePastedSvg(svg, inline.board);
  assert.deepEqual(inline.created[0].frames, [
    {
      name: 'Logo mark',
      width: 24,
      height: 24,
      designSystem: { id: 'droidex', version: 1, mode: 'light' },
      seed: { kind: 'svg', assetId: 'ast_logo' },
    },
  ]);
  assert.deepEqual(inline.focused, ['dsg_logo']);
  assert.deepEqual(shown, []);

  const styled = fakeBoard({ svgAsImage: [{ designId: 'dsg_logo', reason: 'stylesheet' }] });
  await placePastedSvg(svg, styled.board);
  assert.deepEqual(
    shown.map((item) => [item.variant, item.message]),
    [
      [
        'info',
        'Logo mark was placed as an image because it styles its shapes with CSS rules that can’t be written onto them.',
      ],
    ],
  );
});

test('a paste begun before the board left its canvas creates nothing and says nothing', async () => {
  const { board, created, focused, leave } = fakeBoard();
  board.importSvg = async () => {
    leave();
    return asset;
  };
  await placePastedSvg({ name: 'Logo mark', markup: async () => FIGMA }, board);
  assert.deepEqual(created, []);
  assert.deepEqual(focused, []);

  const failing = fakeBoard();
  failing.board.importSvg = async () => {
    failing.leave();
    throw new Error('The SVG could not be read.');
  };
  await placePastedSvg({ name: 'Logo mark', markup: async () => FIGMA }, failing.board);
  assert.deepEqual(shown, []);
});
