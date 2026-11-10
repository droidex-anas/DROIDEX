import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commitStyles,
  editDraft,
  previewedStyles,
  previewStyle,
  revertStyle,
  type ElementEditDraft,
} from './elementEditDraft';
import type { SourceElement } from './protocol';
import { pickPreview, type PickerHover } from './usePickPreview';

const element = { designId: 'design', revisionId: 'r1', elementId: 'el_1', instancePath: '0' };
const site: SourceElement = {
  elementId: 'el_1',
  file: 'main.tsx',
  start: 40,
  end: 90,
  line: 2,
  tagName: 'p',
  component: null,
  editability: 'literal',
};

/**
 * The panel over a real draft, driven as the editor drives it: a preview
 * records what the guest drew, and the guest then reports what it draws.
 */
function panelOn(computed: Record<string, string>) {
  let draft: ElementEditDraft = editDraft('canvas', element, site);
  let hover: PickerHover | null = null;
  const commits: unknown[] = [];
  const preview = (property: string, value: string) => {
    draft = previewStyle(draft, property, value, computed[property] ?? '');
    Object.assign(computed, previewedStyles(draft));
  };
  const panel = () =>
    pickPreview(
      hover,
      (next) => {
        hover = next;
      },
      {
        draft,
        computed,
        readOnly: false,
        onPreview: preview,
        onRevert: (property) => {
          draft = revertStyle(draft, property);
        },
        onCommit: () => {
          commits.push(commitStyles(draft, 'm')?.input.edit.change);
        },
      },
    );
  return { panel, preview, commits, draft: () => draft };
}

test('a hovered option previews while the field keeps its face, and leaving takes it back', () => {
  const { panel, draft } = panelOn({ boxShadow: 'none' });
  panel().hover('boxShadow')('--ds-shadow-sm');
  panel().hover('boxShadow')('--ds-shadow-md');
  assert.equal(draft().values.boxShadow, '--ds-shadow-md');
  assert.equal(panel().value('boxShadow'), 'none');
  assert.equal(panel().previewed('boxShadow'), false);
  panel().hover('boxShadow')(null);
  assert.deepEqual(draft().values, {});
});

test('a value typed before the list opened is what leaving it puts back', () => {
  const { panel, preview, draft } = panelOn({ paddingTop: '8px' });
  preview('paddingTop', '10px');
  panel().hover('paddingTop')('--ds-space-4');
  assert.equal(panel().value('paddingTop'), '10px');
  assert.equal(panel().previewed('paddingTop'), true);
  panel().hover('paddingTop')(null);
  assert.deepEqual(draft().values, { paddingTop: '10px' });
});

test('a pick after a hover commits the pick, which no later leave takes back', () => {
  const { panel, draft, commits } = panelOn({ boxShadow: 'none' });
  panel().hover('boxShadow')('--ds-shadow-sm');
  panel().pick('boxShadow')('--ds-shadow-md');
  assert.deepEqual(commits, [
    { kind: 'style', styles: [{ property: 'boxShadow', value: '--ds-shadow-md' }] },
  ]);
  assert.equal(panel().value('boxShadow'), '--ds-shadow-md');
  panel().hover('boxShadow')(null);
  assert.equal(draft().values.boxShadow, '--ds-shadow-md');
});

test('hovering blur after blur over a composed filter never piles up its functions', () => {
  const { panel, draft, commits } = panelOn({ filter: 'blur(4px) grayscale(1)' });
  for (const step of ['blur(12px)', 'blur(16px)', '--ds-blur-soft', 'none'])
    panel().hover('filter')(step);
  assert.equal(previewedStyles(draft()).filter, 'grayscale(1)');
  panel().pick('filter')('blur(24px)');
  assert.equal(previewedStyles(draft()).filter, 'blur(24px) grayscale(1)');
  assert.deepEqual(commits, [
    { kind: 'style', styles: [{ property: 'filter', value: 'blur(24px)' }] },
  ]);
});
