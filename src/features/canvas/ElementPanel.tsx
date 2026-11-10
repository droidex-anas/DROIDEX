// The selected element's text and styles while Edit has one, in a full-height
// column at the board's right: typed controls grouped the way a designer reads
// them — content, layout, size, spacing, typography, fill, border, effects —
// reading the values the preview computes, with the kit's tokens one press
// away. A flex or grid container shows its alignment, and an item of one its
// own. Typing previews in the guest; picking a segment, option, token or swatch
// applies at once; Enter commits every style preview as one edit, or the text
// as its own, and Escape takes one back.

import type { ReactNode, Ref } from 'react';
import { ChevronRight } from '@droidex/icons';
import type { HistoryStep } from './boardHistory';
import { historyStep, isBoardEditor } from './boardKeys';
import { ColourField } from './ColourField';
import { hasPreviews } from './elementEditDraft';
import { ElementEffects } from './ElementEffects';
import {
  ALIGN,
  ALIGN_COLUMN,
  ALIGN_SELF,
  BORDER_STYLE,
  DIRECTION,
  displayFor,
  JUSTIFY,
  JUSTIFY_COLUMN,
  LAYOUT,
  layoutOf,
  type Layout,
  MORE_DISPLAYS,
  OVERFLOW,
  TEXT_ALIGN,
  TEXT_TRANSFORM,
  WEIGHTS,
  WRAP,
} from './elementPanelChoices';
import { Labelled, Pair, Section } from './ElementPanelRows';
import { ElementTextField } from './ElementTextField';
import { NumberField } from './NumberField';
import { firstFamily, sameFontStack } from './panelValues';
import { isDrawn } from './previewDocument';
import { MoreSegments, SegmentedControl, type Segment } from './SegmentedControl';
import type { EditToken, ElementRef, FrameRect, SourceElement } from './protocol';
import { NoneMode, SizeMode } from './SizeModeMenu';
import { bareTokenName } from './systemDocument/documentSections';
import type { ElementSelection } from './useElementEditor';
import { usePickPreview } from './usePickPreview';
import { ValuePickerField, type ValueOption } from './ValuePickerField';

export interface ElementPanelProps {
  ref: Ref<HTMLDivElement>;
  selection: ElementSelection;
  /** The name of the frame the element is in, which leads its breadcrumb. */
  frameName: string;
  /** The selected design's kit tokens by property; null until they load. */
  tokens: Record<string, EditToken[]> | null;
  /** The mode the selected design previews its kit in. */
  mode: 'light' | 'dark';
  /** Each names the element it was drawn for, and edits nothing once that is no longer selected. */
  onPreview: (property: string, value: string, element: ElementRef) => boolean;
  onRevert: (property: string, element: ElementRef) => boolean;
  onCommit: (element: ElementRef) => void;
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
  frameName,
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
  const { value, previewed, preview, revert, commit, pick, hover } = usePickPreview({
    draft,
    computed: shown.styles,
    readOnly,
    onPreview,
    onRevert,
    onCommit,
  });
  /**
   * The property's kit tokens as picker options, with the mode's value as the
   * hint; undefined until they load.
   */
  const tokenOptions = (property: string, colour = false): ValueOption[] | undefined =>
    tokens === null
      ? undefined
      : (tokens[property] ?? []).map((token) => {
          const hint = 'value' in token ? token.value : token[mode];
          return {
            value: token.name,
            label: bareTokenName(token.name),
            hint,
            ...(colour ? { swatch: hint } : {}),
          };
        });
  /** Why a token-only picker is off once the kit's tokens have loaded without any. */
  const noTokens = (options: ValueOption[], kind: string) =>
    tokens !== null && options.length === 0 && `This kit defines no ${kind}.`;
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
      onPreview={preview(property)}
      onRevert={revert(property)}
      onCommit={commit}
      onLeave={onLeave}
      onPick={pick(property)}
      onActive={hover(property)}
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
      onPreview={preview(property)}
      onRevert={revert(property)}
      onCommit={commit}
      onLeave={onLeave}
      onPick={pick(property)}
      onActive={hover(property)}
    />
  );

  const display = value('display');
  const layout = layoutOf(display);
  const column = value('flexDirection').startsWith('column');
  const parent = layoutOf(shown.parentDisplay);
  const fontTokens = tokenOptions('fontFamily') ?? [];
  const fontFamily = value('fontFamily');
  const fontToken = fontTokens.find((option) => sameFontStack(option.hint ?? '', fontFamily));
  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Styles of the selected ${draft.site.tagName}`}
      className={SIDEBAR}
      onKeyDown={(event) => {
        const step = historyStep(event);
        if (!step) return;
        // Typing not yet saved comes back through the field's own undo first,
        // and a field in a popover, such as a picker's search, keeps its own.
        const inPopover = !(
          event.target instanceof Node && event.currentTarget.contains(event.target)
        );
        if (isBoardEditor(event.target) && (inPopover || hasPreviews(draft))) return;
        event.preventDefault();
        // A step now would move the head out from under the commit still saving.
        if (draft.pending === null) onHistory(step);
      }}
    >
      <header className="shrink-0 px-3 pb-2 pt-3">
        <h2 className="flex min-w-0 items-center gap-1 text-body">
          <span className="min-w-0 truncate text-muted" title={frameName}>
            {frameName}
          </span>
          <ChevronRight aria-hidden className="size-icon-sm shrink-0 text-muted" />
          <span className="shrink-0 text-body-strong text-primary">{draft.site.tagName}</span>
        </h2>
        <p className="mt-0.5 flex min-w-0 items-baseline gap-2 text-caption text-muted">
          <span className="truncate" title={draft.site.file}>
            {fileName(draft.site.file)}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">{sizeText(shown.rect)}</span>
        </p>
        {!editable && (
          <p className="mt-1.5 text-caption text-secondary">{agentRoute(draft.site.editability)}</p>
        )}
      </header>
      <div className="scroll-fade-y scrollbar-on-hover min-h-0 flex-1 overflow-y-auto px-3">
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
          <SegmentedControl
            label="Display"
            options={LAYOUT}
            value={layout ?? ''}
            disabled={readOnly}
            onPick={(next) => {
              pick('display')(displayFor(display, next));
            }}
            more={
              <MoreSegments
                label="More displays"
                options={MORE_DISPLAYS}
                value={display}
                disabled={readOnly}
                onPick={pick('display')}
              />
            }
          />
          {layout === 'flex' && (
            <>
              {segmented('flexDirection', 'Direction', DIRECTION)}
              {segmented('flexWrap', 'Wrap', WRAP)}
            </>
          )}
          {placesItems(layout) && (
            <>
              {segmented('justifyContent', 'Justify', column ? JUSTIFY_COLUMN : JUSTIFY)}
              {segmented('alignItems', 'Align', column ? ALIGN_COLUMN : ALIGN)}
            </>
          )}
          {layout === 'flex' && number('gap', 'Gap', 'Gap', { min: 0 })}
          {layout === 'grid' && (
            <Pair>
              {number('rowGap', 'Row gap', 'Row', { min: 0 })}
              {number('columnGap', 'Column gap', 'Col', { min: 0 })}
            </Pair>
          )}
          {placesItems(parent) && segmented('alignSelf', 'Align self', ALIGN_SELF)}
          {parent === 'flex' && (
            <Pair>{number('flexGrow', 'Flex grow', 'Grow', { unit: null, min: 0 })}</Pair>
          )}
          <Labelled label="Overflow">
            <ValuePickerField
              label="Overflow"
              options={OVERFLOW}
              value={value('overflow')}
              disabled={readOnly}
              onPick={pick('overflow')}
              onActive={hover('overflow')}
            />
          </Labelled>
        </Section>
        <Section title="Size">
          <Pair>
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
          </Pair>
        </Section>
        <Section title="Spacing">
          {number('padding', 'Padding', 'Padding', { min: 0 })}
          <Pair>
            {number('paddingTop', 'Padding top', 'T', { min: 0 })}
            {number('paddingRight', 'Padding right', 'R', { min: 0 })}
            {number('paddingBottom', 'Padding bottom', 'B', { min: 0 })}
            {number('paddingLeft', 'Padding left', 'L', { min: 0 })}
          </Pair>
          {number('margin', 'Margin', 'Margin')}
          <Pair>
            {number('marginTop', 'Margin top', 'T')}
            {number('marginRight', 'Margin right', 'R')}
            {number('marginBottom', 'Margin bottom', 'B')}
            {number('marginLeft', 'Margin left', 'L')}
          </Pair>
        </Section>
        <Section title="Typography">
          <Labelled label="Font" note={noTokens(fontTokens, 'fonts')}>
            <ValuePickerField
              label="Font"
              options={fontTokens}
              value={fontToken?.value ?? fontFamily}
              face={firstFamily(fontFamily)}
              disabled={readOnly || fontTokens.length === 0}
              onPick={pick('fontFamily')}
              onActive={hover('fontFamily')}
            />
          </Labelled>
          <Labelled label="Weight">
            <ValuePickerField
              label="Font weight"
              options={[...(tokenOptions('fontWeight') ?? []), ...WEIGHTS]}
              value={value('fontWeight')}
              disabled={readOnly}
              onPick={pick('fontWeight')}
              onActive={hover('fontWeight')}
            />
          </Labelled>
          <Pair>
            {number('fontSize', 'Font size', 'Size', { min: 1 })}
            {number('lineHeight', 'Line height', 'Line', {
              unit: null,
              step: 0.1,
              shiftStep: 1,
              min: 0,
            })}
            {number('letterSpacing', 'Letter spacing', 'Letter', { step: 0.1, shiftStep: 1 })}
          </Pair>
          {segmented('textAlign', 'Text align', TEXT_ALIGN)}
          <Labelled label="Case">
            <ValuePickerField
              label="Text transform"
              options={TEXT_TRANSFORM}
              value={value('textTransform')}
              disabled={readOnly}
              onPick={pick('textTransform')}
              onActive={hover('textTransform')}
            />
          </Labelled>
          <Labelled label="Colour">{colour('color', 'Text colour')}</Labelled>
        </Section>
        <Section title="Fill">
          <Labelled label="Fill">{colour('backgroundColor', 'Fill')}</Labelled>
        </Section>
        <Section title="Border">
          <Labelled label="Colour">{colour('borderColor', 'Border colour')}</Labelled>
          {segmented('borderStyle', 'Style', BORDER_STYLE)}
          <Pair>
            {number('borderWidth', 'Border width', 'Width', { min: 0 })}
            {number('borderRadius', 'Corner radius', 'Radius', { min: 0 })}
          </Pair>
        </Section>
        <ElementEffects
          value={value}
          tokenOptions={tokenOptions}
          disabled={readOnly}
          onPick={pick}
          onHover={hover}
        >
          <Pair>
            {number('opacity', 'Opacity', 'Opacity', {
              unit: null,
              step: 0.01,
              shiftStep: 0.1,
              min: 0,
              max: 1,
            })}
          </Pair>
        </ElementEffects>
      </div>
      <p role="status" className="shrink-0 px-3 pb-3 pt-2 text-caption text-secondary">
        {status(draft, editable)}
      </p>
    </div>
  );
}

/** The column at the board's right, full height, scrolling its own fields. */
const SIDEBAR = 'canvas-element-panel flex h-full w-sidebar shrink-0 flex-col bg-surface';

/** Edit with nothing picked yet: the column holds its place and says how to start. */
export function EmptyElementPanel() {
  return (
    <div role="region" aria-label="Element styles" className={SIDEBAR}>
      <div className="px-3 pt-3">
        <h2 className="text-body-strong text-primary">Edit</h2>
        <p className="mt-1 text-caption text-secondary">
          Pick an element in a design to edit its styles. Enter picks the first one.
        </p>
      </div>
    </div>
  );
}

/** Flex and grid place their items, so they and their items take alignment. */
function placesItems(layout: Layout | null): boolean {
  return layout === 'flex' || layout === 'grid';
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

function sizeText(rect: FrameRect): string {
  if (!isDrawn(rect)) return 'Hidden';
  return `${String(Math.round(rect.width))} × ${String(Math.round(rect.height))}`;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
