import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapTabFocus } from './focusTrap';

interface FakeElement {
  name: string;
  tabIndex: number;
  focus(): void;
}

function fakeDialog(controlCount: number, skippedEdges = false) {
  const doc: { activeElement: FakeElement | null } = { activeElement: null };
  const element = (name: string, tabIndex = 0): FakeElement => {
    const el: FakeElement = { name, tabIndex, focus: () => (doc.activeElement = el) };
    return el;
  };
  const controls = Array.from({ length: controlCount }, (_, i) => element(`control ${i + 1}`));
  const skippedBefore = element('skipped before', -2);
  const skippedAfter = element('skipped after', -1);
  const candidates = skippedEdges ? [skippedBefore, ...controls, skippedAfter] : controls;
  const dialog = Object.assign(element('dialog'), {
    ownerDocument: doc,
    querySelectorAll: (): FakeElement[] => candidates,
  });
  const outside = element('page behind the scrim');
  return {
    doc,
    dialog,
    at: {
      dialog,
      outside,
      first: controls[0],
      middle: controls[1],
      last: controls.at(-1),
      skippedBefore,
      skippedAfter,
    },
  };
}

function pressTab(dialog: ReturnType<typeof fakeDialog>['dialog'], shiftKey: boolean): boolean {
  let prevented = false;
  const event = { key: 'Tab', shiftKey, preventDefault: () => (prevented = true) };
  wrapTabFocus(event, dialog as unknown as HTMLElement);
  return prevented;
}

test('Tab cycles inside the dialog and wraps from its edges, the dialog itself, and the page', () => {
  const rows = [
    { from: 'last', shiftKey: false, to: 'control 1' },
    { from: 'first', shiftKey: true, to: 'control 3' },
    { from: 'dialog', shiftKey: false, to: 'control 1' },
    { from: 'dialog', shiftKey: true, to: 'control 3' },
    { from: 'outside', shiftKey: false, to: 'control 1' },
    { from: 'middle', shiftKey: false, to: 'control 2' },
    { from: 'last', shiftKey: false, to: 'control 1', skippedEdges: true },
    { from: 'first', shiftKey: true, to: 'control 3', skippedEdges: true },
    { from: 'skippedBefore', shiftKey: true, to: 'control 3', skippedEdges: true },
    { from: 'skippedAfter', shiftKey: false, to: 'control 1', skippedEdges: true },
  ] as const;
  for (const row of rows) {
    const { from, shiftKey, to } = row;
    const { doc, dialog, at } = fakeDialog(3, 'skippedEdges' in row && row.skippedEdges);
    doc.activeElement = at[from] ?? null;
    const prevented = pressTab(dialog, shiftKey);
    assert.equal(doc.activeElement?.name, to, `${from} + ${shiftKey ? 'Shift+' : ''}Tab`);
    assert.equal(prevented, from !== 'middle', `${from} lets the browser move focus only inside`);
  }
});

test('Tab stays on the dialog while every control is disabled', () => {
  const { doc, dialog } = fakeDialog(0);
  assert.equal(pressTab(dialog, false), true);
  assert.equal(doc.activeElement?.name, 'dialog');
});
