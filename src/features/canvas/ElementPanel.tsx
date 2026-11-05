// The selected element's styles while Edit has one, in a column at the board's
// right: typed controls grouped the way a designer reads them — layout, size,
// typography, fill, border, radius, effects — reading the values the preview
// computes, with the kit's tokens one press away. Typing previews in the
// guest; picking a segment, option, token or swatch applies at once; Enter
// commits every preview as one edit and Escape takes one back.

import { useRef, useState, type ReactNode, type Ref } from 'react';
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
  ChevronDown,
  JustifyAround,
  JustifyBetween,
  JustifyCenter,
  JustifyEnd,
  JustifyEvenly,
  JustifyStart,
  NoWrap,
  WrapText,
} from '@droidex/icons';
import { Menu } from '../../components/ui/Menu';
import { ColourField } from './ColourField';
import { NumberField } from './NumberField';
import { SegmentedControl, type Segment } from './SegmentedControl';
import type { EditToken, SourceElement } from './protocol';
import { bareTokenName } from './systemDocument/documentSections';
import type { ElementSelection } from './useElementEditor';
import { ValuePickerField, type ValueOption } from './ValuePickerField';

const DIRECTION: Segment<string>[] = [
  { value: 'row', label: 'Direction: row', icon: ArrowRight },
  { value: 'column', label: 'Direction: column', icon: ArrowDown },
  { value: 'row-reverse', label: 'Direction: row, reversed', icon: ArrowLeft },
  { value: 'column-reverse', label: 'Direction: column, reversed', icon: ArrowUp },
];
const WRAP: Segment<string>[] = [
  { value: 'nowrap', label: 'Do not wrap', icon: NoWrap },
  { value: 'wrap', label: 'Wrap', icon: WrapText },
  { value: 'wrap-reverse', label: 'Wrap, reversed', icon: WrapText, iconClassName: '-scale-y-100' },
];
const JUSTIFY: Segment<string>[] = [
  { value: 'flex-start', label: 'Justify to the start', icon: JustifyStart },
  { value: 'center', label: 'Justify to the centre', icon: JustifyCenter },
  { value: 'flex-end', label: 'Justify to the end', icon: JustifyEnd },
  { value: 'space-between', label: 'Justify with space between', icon: JustifyBetween },
  { value: 'space-around', label: 'Justify with space around', icon: JustifyAround },
  { value: 'space-evenly', label: 'Justify with space evenly', icon: JustifyEvenly },
];
const ALIGN: Segment<string>[] = [
  { value: 'flex-start', label: 'Align to the start', icon: AlignItemsStart },
  { value: 'center', label: 'Align to the centre', icon: AlignItemsCenter },
  { value: 'flex-end', label: 'Align to the end', icon: AlignItemsEnd },
  { value: 'baseline', label: 'Align to the baseline', icon: AlignItemsBaseline },
  { value: 'stretch', label: 'Align stretched', icon: AlignItemsStretch },
];
const ALIGN_SELF: Segment<string>[] = [
  { value: 'auto', label: 'Align self: as its container' },
  ...ALIGN.map((segment) => ({ ...segment, label: segment.label.replace('Align', 'Align self') })),
];
const TEXT_ALIGN: Segment<string>[] = [
  { value: 'left', label: 'Align text left', icon: AlignLeft },
  { value: 'center', label: 'Align text centred', icon: AlignCenter },
  { value: 'right', label: 'Align text right', icon: AlignRight },
  { value: 'justify', label: 'Justify text', icon: AlignJustify },
];
const BORDER_STYLE: Segment<string>[] = [
  { value: 'solid', label: 'Border: solid', icon: BorderSolid },
  { value: 'dashed', label: 'Border: dashed', icon: BorderDashed },
  { value: 'dotted', label: 'Border: dotted', icon: BorderDotted },
  { value: 'double', label: 'Border: double', icon: BorderDouble },
  { value: 'none', label: 'Border: none' },
];

const DISPLAY: ValueOption[] = [
  { value: 'block', label: 'Block' },
  { value: 'inline-block', label: 'Inline block' },
  { value: 'inline', label: 'Inline' },
  { value: 'flex', label: 'Flex' },
  { value: 'inline-flex', label: 'Inline flex' },
  { value: 'grid', label: 'Grid' },
  { value: 'none', label: 'Hidden' },
];
const OVERFLOW: ValueOption[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'clip', label: 'Clip' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'auto', label: 'Auto' },
];
const TEXT_TRANSFORM: ValueOption[] = [
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
const WEIGHTS: ValueOption[] = Object.entries(WEIGHT_NAMES).map(([value, name]) => ({
  value,
  label: `${value} ${name}`,
  hint: value,
}));

export interface ElementPanelProps {
  ref: Ref<HTMLDivElement>;
  selection: ElementSelection;
  /** The selected design's kit tokens by property; null until they load. */
  tokens: Record<string, EditToken[]> | null;
  /** The mode the selected design previews its kit in. */
  mode: 'light' | 'dark';
  onPreview: (property: string, value: string) => void;
  onRevert: (property: string) => void;
  onCommit: () => void;
  /** Escape on a field with nothing to take back hands the keyboard to the board. */
  onLeave: () => void;
}

export function ElementPanel({
  ref,
  selection,
  tokens,
  mode,
  onPreview,
  onRevert,
  onCommit,
  onLeave,
}: ElementPanelProps) {
  const { draft, shown } = selection;
  const editable = draft.site.editability === 'literal';
  const readOnly = !editable || draft.pendingMutationId !== null;
  const value = (property: string): string =>
    Object.hasOwn(draft.values, property)
      ? (draft.values[property] ?? '')
      : (shown.styles[property] ?? '');
  const previewed = (property: string): boolean => Object.hasOwn(draft.values, property);
  /** A pick from a segment, option or token: previews the value and commits at once. */
  const pick = (property: string) => (next: string) => {
    onPreview(property, next);
    onCommit();
  };
  /** The property's kit tokens as picker options, with the mode's value as the hint. */
  const tokenOptions = (property: string, colour = false): ValueOption[] | undefined =>
    tokens?.[property]?.map((token) => {
      const hint = 'value' in token ? token.value : token[mode];
      return {
        value: token.name,
        label: bareTokenName(token.name),
        hint,
        ...(colour ? { swatch: hint } : {}),
      };
    });
  const segmentValue = (property: string, options: readonly Segment<string>[]): string =>
    options.some((option) => option.value === value(property)) ? value(property) : '';

  const number = (
    property: string,
    label: string,
    short: string,
    options: {
      unit?: 'px' | null;
      step?: number;
      shiftStep?: number;
      min?: number;
      max?: number;
      trailing?: ReactNode;
    } = {},
  ) => (
    <NumberField
      label={label}
      short={short}
      value={value(property)}
      previewed={previewed(property)}
      disabled={readOnly}
      unit={options.unit === undefined ? 'px' : options.unit}
      step={options.step ?? 1}
      shiftStep={options.shiftStep ?? 10}
      min={options.min}
      max={options.max}
      tokens={tokenOptions(property)}
      trailing={options.trailing}
      onPreview={(next) => {
        onPreview(property, next);
      }}
      onRevert={() => {
        onRevert(property);
      }}
      onCommit={onCommit}
      onLeave={onLeave}
      onPick={pick(property)}
    />
  );
  const segmented = (property: string, label: string, options: readonly Segment<string>[]) => (
    <SegmentedControl
      label={label}
      options={options}
      value={segmentValue(property, options)}
      disabled={readOnly}
      onPick={pick(property)}
    />
  );
  const colour = (property: string, label: string) => (
    <ColourField
      label={label}
      value={value(property)}
      previewed={previewed(property)}
      disabled={readOnly}
      tokens={tokenOptions(property, true) ?? []}
      onPreview={(next) => {
        onPreview(property, next);
      }}
      onRevert={() => {
        onRevert(property);
      }}
      onCommit={onCommit}
      onLeave={onLeave}
      onPick={pick(property)}
    />
  );

  const shadowTokens = tokenOptions('boxShadow') ?? [];
  const fontTokens = tokenOptions('fontFamily') ?? [];
  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Styles of the selected ${draft.site.tagName}`}
      className="canvas-element-panel my-2 mr-2 flex w-80 shrink-0 flex-col rounded-xl bg-surface"
    >
      <header className="shrink-0 px-3 pb-2 pt-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-body-strong text-primary">{draft.site.tagName}</span>
          <span className="truncate text-caption text-muted" title={draft.site.file}>
            {fileName(draft.site.file)}
          </span>
          <span className="ml-auto shrink-0 text-caption tabular-nums text-muted">
            {Math.round(shown.rect.width)} × {Math.round(shown.rect.height)}
          </span>
        </h2>
        {!editable && (
          <p className="mt-1.5 text-caption text-secondary">{agentRoute(draft.site.editability)}</p>
        )}
      </header>
      <div className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <Section title="Layout">
          <ValuePickerField
            label="Display"
            options={DISPLAY}
            value={value('display')}
            disabled={readOnly}
            onPick={pick('display')}
          />
          {segmented('flexDirection', 'Direction', DIRECTION)}
          {segmented('flexWrap', 'Wrap', WRAP)}
          {segmented('justifyContent', 'Justify', JUSTIFY)}
          {segmented('alignItems', 'Align', ALIGN)}
          {segmented('alignSelf', 'Align self', ALIGN_SELF)}
          <Row>
            {number('gap', 'Gap', 'Gap', { min: 0 })}
            {number('flexGrow', 'Flex grow', 'Grow', { unit: null, min: 0 })}
          </Row>
          <Row>
            {number('rowGap', 'Row gap', 'Row', { min: 0 })}
            {number('columnGap', 'Column gap', 'Column', { min: 0 })}
          </Row>
          <ValuePickerField
            label="Overflow"
            options={OVERFLOW}
            value={value('overflow')}
            disabled={readOnly}
            onPick={pick('overflow')}
          />
        </Section>
        <Section title="Size">
          <Row>
            {number('width', 'Width', 'W', {
              min: 0,
              trailing: (
                <SizeMode
                  label="Width"
                  extent={shown.rect.width}
                  value={value('width')}
                  onPick={pick('width')}
                />
              ),
            })}
            {number('height', 'Height', 'H', {
              min: 0,
              trailing: (
                <SizeMode
                  label="Height"
                  extent={shown.rect.height}
                  value={value('height')}
                  onPick={pick('height')}
                />
              ),
            })}
          </Row>
          <Row>
            {number('minWidth', 'Minimum width', 'Min W', { min: 0 })}
            {number('maxWidth', 'Maximum width', 'Max W', {
              min: 0,
              trailing: (
                <NoneMode
                  label="Maximum width"
                  value={value('maxWidth')}
                  onPick={pick('maxWidth')}
                />
              ),
            })}
          </Row>
          <Row>
            {number('minHeight', 'Minimum height', 'Min H', { min: 0 })}
            {number('maxHeight', 'Maximum height', 'Max H', {
              min: 0,
              trailing: (
                <NoneMode
                  label="Maximum height"
                  value={value('maxHeight')}
                  onPick={pick('maxHeight')}
                />
              ),
            })}
          </Row>
        </Section>
        <Section title="Spacing">
          {number('padding', 'Padding', 'Padding', { min: 0 })}
          <Row>
            {number('paddingTop', 'Padding top', 'Top', { min: 0 })}
            {number('paddingRight', 'Padding right', 'Right', { min: 0 })}
          </Row>
          <Row>
            {number('paddingBottom', 'Padding bottom', 'Bottom', { min: 0 })}
            {number('paddingLeft', 'Padding left', 'Left', { min: 0 })}
          </Row>
          {number('margin', 'Margin', 'Margin')}
          <Row>
            {number('marginTop', 'Margin top', 'Top')}
            {number('marginRight', 'Margin right', 'Right')}
          </Row>
          <Row>
            {number('marginBottom', 'Margin bottom', 'Bottom')}
            {number('marginLeft', 'Margin left', 'Left')}
          </Row>
        </Section>
        <Section title="Typography">
          {fontTokens.length > 0 ? (
            <ValuePickerField
              label="Font"
              options={fontTokens}
              value={value('fontFamily')}
              disabled={readOnly}
              onPick={pick('fontFamily')}
            />
          ) : (
            <Caption>This kit defines no fonts.</Caption>
          )}
          <Row>
            {number('fontSize', 'Font size', 'Size', { min: 1 })}
            <ValuePickerField
              label="Font weight"
              options={[...(tokenOptions('fontWeight') ?? []), ...WEIGHTS]}
              value={value('fontWeight')}
              disabled={readOnly}
              onPick={pick('fontWeight')}
            />
          </Row>
          <Row>
            {number('lineHeight', 'Line height', 'Line', {
              unit: null,
              step: 0.1,
              shiftStep: 1,
              min: 0,
            })}
            {number('letterSpacing', 'Letter spacing', 'Letter', { step: 0.1, shiftStep: 1 })}
          </Row>
          {segmented('textAlign', 'Text align', TEXT_ALIGN)}
          <ValuePickerField
            label="Text transform"
            options={TEXT_TRANSFORM}
            value={value('textTransform')}
            disabled={readOnly}
            onPick={pick('textTransform')}
          />
          {colour('color', 'Text colour')}
        </Section>
        <Section title="Fill">{colour('backgroundColor', 'Fill')}</Section>
        <Section title="Border">
          {colour('borderColor', 'Border colour')}
          <Row>
            {number('borderWidth', 'Border width', 'Width', { min: 0 })}
            {segmented('borderStyle', 'Border style', BORDER_STYLE)}
          </Row>
        </Section>
        <Section title="Radius">
          {number('borderRadius', 'Corner radius', 'Radius', { min: 0 })}
        </Section>
        <Section title="Effects">
          {shadowTokens.length > 0 ? (
            <ValuePickerField
              label="Shadow"
              options={shadowTokens}
              value={value('boxShadow')}
              disabled={readOnly}
              onPick={pick('boxShadow')}
            />
          ) : (
            <Caption>This kit defines no shadows.</Caption>
          )}
          {number('opacity', 'Opacity', 'Opacity', {
            unit: null,
            step: 0.01,
            shiftStep: 0.1,
            min: 0,
            max: 1,
          })}
        </Section>
      </div>
      <p role="status" className="shrink-0 px-3 pb-3 pt-2 text-caption text-muted">
        {status(draft, editable)}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="pt-2">
      <h3 className="pb-1.5 text-label text-muted">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

/** Two fields side by side. */
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 items-start gap-1">{children}</div>;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-caption text-quiet">{children}</p>;
}

function sizeMode(value: string): 'Fixed' | 'Hug' | 'Fill' {
  if (value === 'fit-content') return 'Hug';
  if (value === '100%') return 'Fill';
  return 'Fixed';
}

/** A width or height's sizing mode: fixed at a length, hugging contents, or filling. */
function SizeMode({
  label,
  extent,
  value,
  onPick,
}: {
  label: string;
  /** The element's drawn size on this axis, which Fixed fixes to. */
  extent: number;
  value: string;
  onPick: (value: string) => void;
}) {
  const mode = sizeMode(value);
  return (
    <ModeMenu
      label={`${label} sizing`}
      mode={mode}
      choices={[
        {
          name: 'Fixed',
          pick: () => {
            onPick(`${String(Math.round(extent))}px`);
          },
        },
        {
          name: 'Hug contents',
          pick: () => {
            onPick('fit-content');
          },
        },
        {
          name: 'Fill container',
          pick: () => {
            onPick('100%');
          },
        },
      ]}
    />
  );
}

/** A maximum's mode: fixed at a length, or none. */
function NoneMode({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <ModeMenu
      label={label}
      mode={value === 'none' ? 'None' : 'Fixed'}
      choices={[
        // Fixed needs a length, so the number field is the way back to it.
        { name: 'Fixed' },
        {
          name: 'None',
          pick: () => {
            onPick('none');
          },
        },
      ]}
    />
  );
}

function ModeMenu({
  label,
  mode,
  choices,
}: {
  label: string;
  mode: string;
  choices: { name: string; pick?: () => void }[];
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`${label}, now ${mode}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        className="flex h-6 shrink-0 cursor-pointer items-center rounded-sm px-0.5 text-label text-muted transition-colors duration-quick ease-smooth-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {mode !== 'Fixed' && mode}
        <ChevronDown aria-hidden className="size-icon-sm" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchor}
        label={label}
        width={140}
      >
        {choices.map((choice) => (
          <Menu.Item
            key={choice.name}
            onSelect={() => {
              setOpen(false);
              if (choice.name !== mode) choice.pick?.();
            }}
          >
            {choice.name}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}

/** Shared and computed sites are the agent's: one edit here could change what is not selected. */
function agentRoute(editability: SourceElement['editability']): string {
  return editability === 'shared'
    ? 'This element is written once and used in several places. Ask the agent to change it.'
    : 'This element’s styles are worked out in code. Ask the agent to change it.';
}

function status(draft: ElementSelection['draft'], editable: boolean): string {
  if (!editable) return 'Read only.';
  if (draft.pendingMutationId !== null) return 'Saving…';
  return 'Enter saves your changes; Escape takes one back.';
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
