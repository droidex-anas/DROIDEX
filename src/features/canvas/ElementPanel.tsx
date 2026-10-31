// The selected element's styles while Edit has one, in a column at the board's
// right: the values its preview computes, one field per property the edit
// whitelist allows, grouped the way a designer reads them, and what the last
// commit wrote. Typing previews in the guest; Enter commits one property and
// Escape takes its preview back.

import type { KeyboardEvent, Ref } from 'react';
import { Input } from '../../components/ui/Field';
import { cn } from '../../components/ui/cn';
import type { SourceElement } from './protocol';
import type { ElementSelection } from './useElementEditor';

/** One field: the style property it edits and the short name shown in it. */
interface StyleField {
  property: string;
  /** Part of the field's accessible name, which is the property's full name. */
  label: string;
}

/** A row holds one field across the panel, or two side by side. */
type StyleRow = [StyleField] | [StyleField, StyleField];

const field = (property: string, label: string): StyleField => ({ property, label });

// Every property in STYLE_PROPERTIES has exactly one place here.
const SECTIONS: { title: string; rows: StyleRow[] }[] = [
  {
    title: 'Layout',
    rows: [
      [field('flexDirection', 'Direction')],
      [field('alignItems', 'Align')],
      [field('justifyContent', 'Justify')],
      [field('gap', 'Gap')],
      [field('rowGap', 'Row'), field('columnGap', 'Column')],
    ],
  },
  {
    title: 'Size',
    rows: [
      [field('width', 'Width'), field('height', 'Height')],
      [field('minWidth', 'Min width')],
      [field('maxWidth', 'Max width')],
      [field('minHeight', 'Min height')],
      [field('maxHeight', 'Max height')],
    ],
  },
  {
    title: 'Spacing',
    rows: [
      [field('padding', 'Padding')],
      [field('paddingTop', 'Top'), field('paddingRight', 'Right')],
      [field('paddingBottom', 'Bottom'), field('paddingLeft', 'Left')],
      [field('margin', 'Margin')],
      [field('marginTop', 'Top'), field('marginRight', 'Right')],
      [field('marginBottom', 'Bottom'), field('marginLeft', 'Left')],
    ],
  },
  {
    title: 'Text',
    rows: [
      [field('fontFamily', 'Font')],
      [field('fontSize', 'Size'), field('fontWeight', 'Weight')],
      [field('lineHeight', 'Line'), field('letterSpacing', 'Letter')],
    ],
  },
  {
    title: 'Colour',
    rows: [
      [field('color', 'Colour')],
      [field('backgroundColor', 'Background')],
      [field('borderColor', 'Border')],
    ],
  },
  {
    title: 'Appearance',
    rows: [
      [field('opacity', 'Opacity'), field('borderRadius', 'Radius')],
      [field('boxShadow', 'Shadow')],
    ],
  },
];

const COLOUR_PROPERTIES = new Set(['color', 'backgroundColor', 'borderColor']);

export interface ElementPanelProps {
  ref: Ref<HTMLDivElement>;
  selection: ElementSelection;
  onPreview: (property: string, value: string) => void;
  onRevert: (property: string) => void;
  onCommit: (property: string) => void;
  /** Escape on a field with nothing to take back hands the keyboard to the board. */
  onLeave: () => void;
}

export function ElementPanel({
  ref,
  selection,
  onPreview,
  onRevert,
  onCommit,
  onLeave,
}: ElementPanelProps) {
  const { draft, shown } = selection;
  const editable = draft.site.editability === 'literal';
  const readOnly = !editable || draft.pendingMutationId !== null;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, property: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit(property);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (Object.hasOwn(draft.values, property)) onRevert(property);
      else onLeave();
    }
  };
  const renderField = ({ property, label }: StyleField, wide: boolean) => {
    const previewed = Object.hasOwn(draft.values, property);
    const value = previewed ? draft.values[property] : (shown.styles[property] ?? '');
    return (
      <Input
        key={property}
        variant="compact"
        aria-label={propertyLabel(property)}
        value={value}
        title={value}
        readOnly={readOnly}
        spellCheck={false}
        // An unsaved preview steps up a tone, and its name brightens with it.
        className={cn('tabular-nums', previewed && 'bg-active')}
        leading={
          <span
            className={cn(
              'flex shrink-0 items-center gap-1.5 pr-2 text-label',
              wide ? 'w-20' : 'w-16',
              previewed && 'text-primary',
            )}
          >
            {COLOUR_PROPERTIES.has(property) && <Swatch colour={value} />}
            <span className="truncate">{label}</span>
          </span>
        }
        onChange={(event) => {
          onPreview(property, event.target.value);
        }}
        onKeyDown={(event) => {
          onKeyDown(event, property);
        }}
      />
    );
  };
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
        {SECTIONS.map(({ title, rows }) => (
          <section key={title} aria-label={title} className="pt-2">
            <h3 className="pb-1.5 text-label text-muted">{title}</h3>
            <div className="flex flex-col gap-1">
              {rows.map((row) => (
                <div key={row[0].property} className="grid grid-cols-2 gap-1">
                  {row.length === 1 ? (
                    <div className="col-span-2">{renderField(row[0], true)}</div>
                  ) : (
                    row.map((each) => renderField(each, false))
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p role="status" className="shrink-0 px-3 pb-3 pt-2 text-caption text-muted">
        {status(selection, editable)}
      </p>
    </div>
  );
}

/** The value's own colour, edged so any colour reads on any surface. */
function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-xs"
      // The same neutral hairline as ColorPicker's swatch.
      style={{ backgroundColor: colour, boxShadow: 'inset 0 0 0 1px rgba(128, 128, 128, 0.3)' }}
    />
  );
}

/** Shared and computed sites are the agent's: one edit here could change what is not selected. */
function agentRoute(editability: SourceElement['editability']): string {
  return editability === 'shared'
    ? 'This element is written once and used in several places. Ask the agent to change it.'
    : 'This element’s styles are worked out in code. Ask the agent to change it.';
}

function status({ draft, written }: ElementSelection, editable: boolean): string {
  if (!editable) return 'Read only.';
  if (draft.pendingMutationId !== null) return 'Saving…';
  if (written) {
    const name = propertyLabel(written.property);
    if (written.resolution?.kind === 'token')
      return `${name} now uses ${written.resolution.token}.`;
    if (written.resolution?.kind === 'raw')
      return `${name} is now ${written.resolution.value}; no design system token matches it.`;
  }
  return 'Enter saves a change; Escape takes it back.';
}

/** `backgroundColor` as a person reads it: "Background colour". */
function propertyLabel(property: string): string {
  const words = property
    .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    .replace(/\bcolor\b/, 'colour');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
