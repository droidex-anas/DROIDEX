// The board's element selection channel in the production preview host: the
// intermediate's pick, select, hover and probe commands, the reporter inside
// the generated frame that answers them, and the readers that bound the answer.

import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import {
  PREVIEW_STARTED,
  previewHoverScript,
  previewPickScript,
  previewProbeScript,
  previewSelectScript,
  previewStartScript,
  readPreviewFinding,
  readPreviewHover,
  type PreviewElement,
  type PreviewPick,
  type PreviewProbe,
  type PreviewTarget,
} from '../../src/features/canvas/previewDocument';
import {
  previewShapeScript,
  readPreviewShape,
} from '../../src/features/canvas/previewDocumentShape';
import { pickedElement } from '../../src/features/canvas/pickedElement';
import type { CanvasFrame } from '../../src/features/canvas/protocol';
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
    'main.tsx': `const names = Array.from({ length: 80 }, (_, index) => 'name' + index).join(', ');
const times = Array.from({ length: 150 }, () => '1s').join(', ');
const LONG_STYLES = {
  fontFamily: names,
  transitionProperty: names,
  transitionDuration: times,
  transitionDelay: times,
  animationName: names,
  animationDuration: times,
  animationDelay: times,
  counterReset: names.replaceAll(',', ''),
};

export default function Card() {
  return (
    <section style={{ padding: '8px', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ margin: '0px', fontSize: '24px' }}>Title</h1>
      <p style={{ margin: '0px' }}>Body</p>
      <footer style={LONG_STYLES}>{'é'.repeat(256)}</footer>
      <p style={{ margin: '0px', width: '10ch', fontFamily: 'monospace' }}>
        aaaaaaaaa aaaa <b>bbbb</b> ccccccccc
      </p>
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
    assert.equal(picked.text, 'Title');
    assert.equal(picked.parentDisplay, 'flex');

    // A hover names the element under a point and selects nothing.
    const hovered = readPreviewHover(await askGuest(page, previewHoverScript({ x: 20, y: 20 })));
    assert.equal(hovered?.elementId, heading.elementId);
    assert.equal(hovered.tagName, 'h1');
    assert.equal(hovered.rect.y, 8);
    // Only its section is above it, and the paragraph follows with no margin.
    assert.deepEqual(hovered.room, { above: null, below: 0 });
    assert.equal(
      readPreviewHover(await askGuest(page, previewHoverScript({ x: 5000, y: 5000 }))),
      null,
    );

    // A probe names the element at a point, or the text between two points and
    // the element holding it, and selects nothing: the steps below still start
    // from the heading. A pick of what it found names the source it is written in.
    const probe = async (asked: PreviewProbe) =>
      readPreviewFinding(await askGuest(page, previewProbeScript(asked)));
    const atHeading = await probe({ at: { x: 20, y: 20 } });
    assert.deepEqual(atHeading, {
      elementId: heading.elementId,
      instancePath: picked.instancePath,
      rect: picked.rect,
      text: null,
    });
    const frame: Pick<CanvasFrame, 'designId' | 'build'> = {
      designId: instance.designId,
      build: {
        status: 'ready',
        generation: 1,
        revisionId: instance.revisionId,
        artifactId: design.artifactId,
        elements: design.elements,
        diagnostics: [],
      },
    };
    const headingPick = pickedElement(frame, instance.revisionId, atHeading);
    assert.deepEqual(headingPick?.source, {
      file: 'main.tsx',
      start: heading.start,
      end: heading.end,
      line: 17,
    });
    assert.equal(headingPick.component, 'Card');
    assert.equal(headingPick.tagName, 'h1');
    assert.equal(await probe({ at: { x: 5000, y: 5000 } }), null);

    const { x, y, width, height } = picked.rect;
    const middle = y + height / 2;
    // Dragged right to left, the text still reads forwards.
    const words = await probe({
      from: { x: x + width - 1, y: middle },
      to: { x: x + 1, y: middle },
    });
    assert.equal(words?.elementId, heading.elementId);
    assert.equal(words.text?.excerpt, 'Title');
    assert.ok(words.text.rect.width < width, 'the box is the text, not its element');
    const body = await probe({ at: { x: 20, y: y + height + 4 } });
    assert.equal(body?.elementId, design.elements.find((e) => e.tagName === 'p')?.elementId);
    const across = await probe({
      from: { x: x + 1, y: middle },
      to: { x: body.rect.x + body.rect.width - 1, y: body.rect.y + body.rect.height / 2 },
    });
    assert.equal(across?.elementId, section.elementId);
    assert.equal(across.text?.excerpt, 'TitleBody');

    // A text preview replaces what the heading shows, and leaving puts it back;
    // the guest keeps reporting the text the heading holds.
    const title = { elementId: heading.elementId, instancePath: picked.instancePath, styles: {} };
    const typed = await select({ ...title, text: 'Welcome back '.repeat(30) });
    assert.equal(typed?.text, 'Title');
    assert.ok(typed.rect.height > picked.rect.height, 'the longer text wraps');
    assert.equal(await select(null), null);
    assert.equal((await select({ ...title, text: null }))?.rect.height, picked.rect.height);

    // The keyboard steps through the marked elements in document order.
    const next = await pick({ step: 'next' });
    assert.equal(next?.elementId, design.elements.find((e) => e.tagName === 'p')?.elementId);

    // Long style values beside a 512-byte text make an answer past every other
    // event's cap; the selection still arrives, each value cut and the text whole.
    const long = [
      'fontFamily',
      'transitionProperty',
      'transitionDuration',
      'transitionDelay',
      'animationName',
      'animationDuration',
      'animationDelay',
      'counterReset',
    ];
    const footer = await answer((n) => previewPickScript({ step: 'next' }, long, n));
    assert.equal(footer?.elementId, design.elements.find((e) => e.tagName === 'footer')?.elementId);
    assert.equal(footer.text, 'é'.repeat(256));
    assert.deepEqual(Object.keys(footer.styles), long);
    for (const name of long) assert.equal(footer.styles[name]?.length, 512, name);

    // A word in wrapped text has the text's line before it just above and its
    // line after just below, though that text also runs beside it.
    await pick({ step: 'next' });
    const word = await pick({ step: 'next' });
    assert.equal(word?.elementId, design.elements.find((e) => e.tagName === 'b')?.elementId);
    const inText = readPreviewHover(
      await askGuest(page, previewHoverScript({ x: word.rect.x + 1, y: word.rect.y + 1 })),
    );
    assert.equal(inText?.elementId, word.elementId);
    assert.ok(inText.room.above !== null && inText.room.above < 4, 'the line before');
    assert.ok(inText.room.below !== null && inText.room.below < 4, 'the line after');

    // A preview is an inline style the guest computes, and moving away puts it back.
    const parent = await pick({ x: 2, y: 2 });
    assert.equal(parent?.elementId, section.elementId);
    assert.equal(parent.text, null, 'it holds elements, not one text');
    const target = { elementId: section.elementId, instancePath: parent.instancePath, text: null };
    const previewed = await select({ ...target, styles: { paddingTop: '40px' } });
    assert.equal(previewed?.styles.paddingTop, '40px');
    // Picking the element already selected keeps what it previews, and
    // answers with the properties asked for now.
    const again = await answer((n) => previewPickScript({ x: 2, y: 2 }, ['paddingTop', 'gap'], n));
    assert.deepEqual(Object.keys(again?.styles ?? {}), ['paddingTop', 'gap']);
    assert.equal(again?.styles.paddingTop, '40px');
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

test('[C4 shape] the production guest reads a path through its transforms and previews its d', async () => {
  const design = await compileDesign({
    'main.tsx': `const LONG = 'M0 0' + ' L1 1'.repeat(4000);

export default function Mark() {
  return (
    <svg width="200" height="100" viewBox="0 0 20 10" style={{ display: 'block' }}>
      <g transform="translate(2 1)">
        <path d="M0 0
          L10 0 L10 5 Z" />
      </g>
      <circle cx="15" cy="5" r="2" />
      <path d={LONG} />
    </svg>
  );
}
`,
  });

  await withCanvasHost(async (_app, page) => {
    await mountPreviewGuest(page);
    const instance = newInstance('shape');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () => (await drainGuest(page, instance)).events.some((e) => e.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    let sequence = 0;
    const select = async (target: PreviewTarget | null) => {
      sequence += 1;
      const asked = sequence;
      assert.equal(await askGuest(page, previewSelectScript(target, [], asked)), 'sent');
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
    const shapeAt = async (at: { x: number; y: number }) => {
      const found = readPreviewHover(await askGuest(page, previewHoverScript(at)));
      assert.ok(found, `an element at ${at.x}, ${at.y}`);
      return {
        node: { elementId: found.elementId, instancePath: found.instancePath },
        shape: readPreviewShape(await askGuest(page, previewShapeScript(found))),
      };
    };

    // The viewBox scales by 10 and the group moves the path by (2, 1) user
    // units, so its matrix carries both and its box is in the design's pixels.
    const triangle = await shapeAt({ x: 110, y: 20 });
    assert.ok(triangle.shape && 'd' in triangle.shape);
    assert.equal(triangle.shape.d.replace(/\s+/g, ' '), 'M0 0 L10 0 L10 5 Z');
    assert.deepEqual(triangle.shape.matrix, [10, 0, 0, 10, 20, 10]);
    assert.deepEqual(triangle.shape.rect, { x: 20, y: 10, width: 100, height: 50 });
    const circle = await shapeAt({ x: 150, y: 50 });
    assert.deepEqual(circle.shape, { refused: 'not_path' });
    // A path past the reporter's cap is refused, never cut.
    const longPath = design.elements.filter((element) => element.tagName === 'path')[1];
    assert.ok(longPath, 'the compiler mapped the long path');
    const long = {
      elementId: longPath.elementId,
      instancePath: circle.node.instancePath.replace(/\d+$/, '2'),
    };
    assert.deepEqual(readPreviewShape(await askGuest(page, previewShapeScript(long))), {
      refused: 'too_large',
    });

    // A d preview redraws the path, and moving away puts the source's back.
    const target = { ...triangle.node, styles: {}, text: null };
    const wider = await select({ ...target, d: 'M0 0 L18 0 L18 5 Z' });
    assert.equal(wider?.rect.width, 180);
    assert.equal(await select(null), null);
    assert.equal((await select(target))?.rect.width, 100);
    assert.deepEqual((await shapeAt({ x: 110, y: 20 })).shape, triangle.shape);
    // Only the board's own path data, spaces and commas, is previewed.
    assert.equal(
      await askGuest(page, previewSelectScript({ ...target, d: 'M0 0\nL1 1' }, [], 99)),
      'invalid_request',
    );
  });
});
