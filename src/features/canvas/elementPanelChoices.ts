// The fixed choices the element panel offers: the segments for flex layout,
// text alignment and border style, and the options for keyword properties.

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
  { value: 'none', label: 'Border: none' },
];

export const DISPLAY: ValueOption[] = [
  { value: 'block', label: 'Block' },
  { value: 'inline-block', label: 'Inline block' },
  { value: 'inline', label: 'Inline' },
  { value: 'flex', label: 'Flex' },
  { value: 'inline-flex', label: 'Inline flex' },
  { value: 'grid', label: 'Grid' },
  { value: 'none', label: 'Hidden' },
];
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
