// The fixed choices the element panel offers: the segments for layout, flex
// alignment, text alignment and border style, and the options for keyword
// properties. A layout segment keeps whether its element sits inline; the
// displays that are no layout wait in the Display row's ⋯ menu.

import {
  AlignCenter,
  AlignItemsBaseline,
  AlignItemsCenter,
  AlignItemsEnd,
  AlignItemsStart,
  AlignItemsStretch,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BorderDashed,
  BorderDotted,
  BorderDouble,
  BorderSolid,
  JustifyAround,
  JustifyBetween,
  JustifyCenter,
  JustifyEnd,
  JustifyEvenly,
  JustifyStart,
  NoWrap,
  WrapText,
} from '@droidex/icons';
import type { Segment } from './SegmentedControl';
import type { ValueOption } from './ValuePickerField';

export type Layout = 'block' | 'flex' | 'grid';

export const LAYOUT: Segment<Layout>[] = [
  { value: 'block', label: 'Display: block', text: 'Block' },
  { value: 'flex', label: 'Display: flex', text: 'Flex' },
  { value: 'grid', label: 'Display: grid', text: 'Grid' },
];

/**
 * How a `display` lays its children out, whether or not the element itself
 * sits inline; null for one the segments do not name, such as `inline` or `none`.
 */
export function layoutOf(display: string): Layout | null {
  const inner = display.replace(/^inline-/, '');
  return inner === 'block' || inner === 'flex' || inner === 'grid' ? inner : null;
}

/** The `display` a picked layout writes: an element that sits inline stays inline. */
export function displayFor(current: string, layout: Layout): string {
  return current.startsWith('inline') ? `inline-${layout}` : layout;
}

export const MORE_DISPLAYS: Segment<string>[] = [
  { value: 'inline', label: 'Display: inline', text: 'Inline' },
  { value: 'inline-block', label: 'Display: inline-block', text: 'Inline block' },
  { value: 'none', label: 'Display: none', text: 'Hidden' },
];

export const DIRECTION: Segment<string>[] = [
  { value: 'row', label: 'Direction: row', icon: ArrowRight },
  { value: 'column', label: 'Direction: column', icon: ArrowDown },
  { value: 'row-reverse', label: 'Direction: row, reversed', icon: ArrowLeft },
  { value: 'column-reverse', label: 'Direction: column, reversed', icon: ArrowUp },
];
export const WRAP: Segment<string>[] = [
  { value: 'nowrap', label: 'Do not wrap', icon: NoWrap },
  { value: 'wrap', label: 'Wrap', icon: WrapText },
  { value: 'wrap-reverse', label: 'Wrap, reversed', icon: WrapText, iconClassName: '-scale-y-100' },
];
export const JUSTIFY: Segment<string>[] = [
  { value: 'flex-start', label: 'Justify to the start', icon: JustifyStart },
  { value: 'center', label: 'Justify to the centre', icon: JustifyCenter },
  { value: 'flex-end', label: 'Justify to the end', icon: JustifyEnd },
  { value: 'space-between', label: 'Justify with space between', icon: JustifyBetween },
  { value: 'space-around', label: 'Justify with space around', icon: JustifyAround },
  { value: 'space-evenly', label: 'Justify with space evenly', icon: JustifyEvenly },
];
export const ALIGN: Segment<string>[] = [
  { value: 'flex-start', label: 'Align to the start', icon: AlignItemsStart },
  { value: 'center', label: 'Align to the centre', icon: AlignItemsCenter },
  { value: 'flex-end', label: 'Align to the end', icon: AlignItemsEnd },
  { value: 'baseline', label: 'Align to the baseline', icon: AlignItemsBaseline },
  { value: 'stretch', label: 'Align stretched', icon: AlignItemsStretch },
];
/** The same choices for a column, whose main axis runs down: the glyphs turn with it. */
export const JUSTIFY_COLUMN = turned(JUSTIFY, 'rotate-90');
export const ALIGN_COLUMN = turned(ALIGN, '-rotate-90');
export const ALIGN_SELF: Segment<string>[] = [
  { value: 'auto', label: 'Align self: as its container', text: 'Auto' },
  ...ALIGN.map((segment) => ({ ...segment, label: segment.label.replace('Align', 'Align self') })),
];
export const TEXT_ALIGN: Segment<string>[] = [
  { value: 'left', label: 'Align text left', icon: AlignLeft },
  { value: 'center', label: 'Align text centred', icon: AlignCenter },
  { value: 'right', label: 'Align text right', icon: AlignRight },
  { value: 'justify', label: 'Justify text', icon: AlignJustify },
];
export const BORDER_STYLE: Segment<string>[] = [
  { value: 'solid', label: 'Border: solid', icon: BorderSolid },
  { value: 'dashed', label: 'Border: dashed', icon: BorderDashed },
  { value: 'dotted', label: 'Border: dotted', icon: BorderDotted },
  { value: 'double', label: 'Border: double', icon: BorderDouble },
  { value: 'none', label: 'Border: none', text: 'None' },
];

function turned(segments: readonly Segment<string>[], turn: string): Segment<string>[] {
  return segments.map((segment) => ({ ...segment, iconClassName: turn }));
}

export const OVERFLOW: ValueOption[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'clip', label: 'Clip' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'auto', label: 'Auto' },
];
export const TEXT_TRANSFORM: ValueOption[] = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'capitalize', label: 'Capitalize' },
];
const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semi bold',
  '700': 'Bold',
  '800': 'Extra bold',
  '900': 'Black',
};
export const WEIGHTS: ValueOption[] = Object.entries(WEIGHT_NAMES).map(([value, name]) => ({
  value,
  label: `${value} ${name}`,
  hint: value,
}));
