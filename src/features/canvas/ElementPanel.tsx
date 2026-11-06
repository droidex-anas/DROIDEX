// The selected element's text and styles while Edit has one, in a column at the
// board's right: typed controls grouped the way a designer reads them — content,
// layout, size, typography, fill, border, radius, effects — reading the values
// the preview computes, with the kit's tokens one press away. Typing previews in
// the guest; picking a segment, option, token or swatch applies at once; Enter
// commits every style preview as one edit, or the text as its own, and Escape
// takes one back.

import type { ReactNode, Ref } from 'react';
import type { HistoryStep } from './boardHistory';
import { historyStep, isBoardEditor } from './boardKeys';
import { ColourField } from './ColourField';
import { hasPreviews } from './elementEditDraft';
import {
  ALIGN,
  ALIGN_SELF,
  BORDER_STYLE,
  DIRECTION,
  DISPLAY,
  JUSTIFY,
  OVERFLOW,
  TEXT_ALIGN,
  TEXT_TRANSFORM,
  WEIGHTS,
  WRAP,
} from './elementPanelChoices';
import { ElementTextField } from './ElementTextField';
import { NumberField } from './NumberField';
import { SegmentedControl, type Segment } from './SegmentedControl';
import type { EditToken, SourceElement } from './protocol';
import { NoneMode, SizeMode } from './SizeModeMenu';
import { bareTokenName } from './systemDocument/documentSections';
import type { ElementSelection } from './useElementEditor';
import { ValuePickerField, type ValueOption } from './ValuePickerField';

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
  onPreviewText: (text: string) => void;
  onRevertText: () => void;
  onCommitText: () => void;
  /** ⌘Z and its kin once nothing typed here is waiting to be saved. */
  onHistory: (step: HistoryStep) => boolean;
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
  onPreviewText,
  onRevertText,
  onCommitText,
  onHistory,
  onLeave,
}: ElementPanelProps) {
  const { draft, shown } = selection;
  const editable = draft.site.editability === 'literal';
  const readOnly = !editable || draft.pending !== null;
  const text = draft.text ?? shown.text;
  const value = (property: string): string =>
    Object.hasOwn(draft.values, property)
      ? (draft.values[property] ?? '')
      : (shown.styles[property] ?? '');
  const previewed = (property: string): boolean => Object.hasOwn(draft.values, property);
  /** A pick from a segment, option or token: previews the value and commits at once. */
  const pick = (property: string) => (next: string) => {
    if (readOnly) return;
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
      onKeyDown={(event) => {
        const step = historyStep(event);
        if (!step) return;
        // Typing not yet saved comes back through the field's own undo first,
        // and a field in a popover, such as a picker's search, keeps its own.
        const inPopover = !(event.target instanceof Node && event.currentTarget.contains(event.target));
        if (isBoardEditor(event.target) && (inPopover || hasPreviews(draft))) return;
        event.preventDefault();
        // A step now would move the head out from under the commit still saving.
        if (draft.pending === null) onHistory(step);
      }}
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
        {text !== null && (
          <Section title="Content">
            <ElementTextField
              value={text}
              previewed={draft.text !== null}
              disabled={readOnly}
              onPreview={onPreviewText}
              onRevert={onRevertText}
              onCommit={onCommitText}
              onLeave={onLeave}
            />
          </Section>
        )}
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
                  disabled={readOnly}
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
                  disabled={readOnly}
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
                  disabled={readOnly}
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
                  disabled={readOnly}
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
            tokens !== null && <Caption>This kit defines no fonts.</Caption>
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
            tokens !== null && <Caption>This kit defines no shadows.</Caption>
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

/** Shared and computed sites are the agent's: one edit here could change what is not selected. */
function agentRoute(editability: SourceElement['editability']): string {
  return editability === 'shared'
    ? 'This element is written once and used in several places. Ask the agent to change it.'
    : 'This element’s styles are worked out in code. Ask the agent to change it.';
}

function status(draft: ElementSelection['draft'], editable: boolean): string {
  if (!editable) return 'Read only.';
  if (draft.pending !== null) return 'Saving…';
  return 'Enter saves your changes; Escape takes one back.';
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
