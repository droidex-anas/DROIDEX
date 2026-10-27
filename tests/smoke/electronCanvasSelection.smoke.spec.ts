// The board's element selection channel in the production preview host: the
// intermediate's pick and select commands, the reporter inside the generated
// frame that answers them, and the reader that bounds the answer.

import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import {
  PREVIEW_STARTED,
  previewPickScript,
  previewSelectScript,
  previewStartScript,
  type PreviewElement,
  type PreviewPick,
  type PreviewTarget,
} from '../../src/features/canvas/previewDocument';
import {
  askGuest,
  compileDesign,
  drainGuest,
  mountPreviewGuest,
  newInstance,
} from './canvasPreviewHost';
import { withCanvasHost } from './canvasSmoke';
test('[C4 select] the production guest picks, previews and releases a design element', async () => {
  const design = await compileDesign({
    'main.tsx': `export default function Card() {
  return (
    <section style={{ padding: '8px', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ margin: '0px', fontSize: '24px' }}>Title</h1>
      <p style={{ margin: '0px' }}>Body</p>
    </section>
  );
}
`,
  });
  const heading = design.elements.find((element) => element.tagName === 'h1');
  const section = design.elements.find((element) => element.tagName === 'section');
  assert.ok(heading && section, 'the compiler mapped both elements');
  const properties = ['paddingTop', 'fontSize', 'color'];

  await withCanvasHost(async (_app, page) => {
    await mountPreviewGuest(page);
    const instance = newInstance('select');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () => (await drainGuest(page, instance)).events.some((e) => e.event === 'ready'),
        {
          timeout: 20_000,
          intervals: [100],
        },
      )
      .toBe(true);

    /**
     * The guest's answer to one command, read through the production reader:
     * the selection that echoes the sequence number this command was sent with.
     */
    let sequence = 0;
    const answer = async (script: (sequence: number) => string) => {
      sequence += 1;
      const asked = sequence;
      assert.equal(await askGuest(page, script(asked)), 'sent');
      let element: PreviewElement | null | undefined;
      await expect
        .poll(
          async () => {
            for (const event of (await drainGuest(page, instance)).events)
              if (event.event === 'selection' && event.sequence === asked) element = event.element;
            return element !== undefined;
          },
          { timeout: 10_000, intervals: [50] },
        )
        .toBe(true);
      return element ?? null;
    };
    const pick = (at: PreviewPick) => answer((n) => previewPickScript(at, properties, n));
    const select = (target: PreviewTarget | null) =>
      answer((n) => previewSelectScript(target, properties, n));

    // A point over the heading picks the heading, in the guest's own pixels.
    const picked = await pick({ x: 20, y: 20 });
    assert.equal(picked?.elementId, heading.elementId);
    assert.equal(picked.styles.fontSize, '24px');
    assert.equal(picked.rect.x, 8);
    assert.equal(picked.rect.y, 8);

    // The keyboard steps through the marked elements in document order.
    const next = await pick({ step: 'next' });
    assert.equal(next?.elementId, design.elements.find((e) => e.tagName === 'p')?.elementId);

    // A preview is an inline style the guest computes, and moving away puts it back.
    const parent = await pick({ x: 2, y: 2 });
    assert.equal(parent?.elementId, section.elementId);
    const target = { elementId: section.elementId, instancePath: parent.instancePath };
    const previewed = await select({ ...target, styles: { paddingTop: '40px' } });
    assert.equal(previewed?.styles.paddingTop, '40px');
    assert.equal(await select(null), null);
    const restored = await select({ ...target, styles: {} });
    assert.equal(restored?.styles.paddingTop, '8px');

    // A stale or invented target selects nothing rather than something else.
    assert.equal(await select({ ...target, elementId: heading.elementId, styles: {} }), null);
    assert.equal(
      await askGuest(
        page,
        previewSelectScript({ ...target, instancePath: '0/../1', styles: {} }, properties, 99),
      ),
      'invalid_request',
    );
    // A command without a sequence number for its answer to echo is refused too.
    assert.equal(
      await askGuest(page, previewPickScript({ step: 'first' }, properties, 0)),
      'invalid_request',
    );
  });
});
