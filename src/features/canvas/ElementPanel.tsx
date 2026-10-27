// The selected element's styles while Edit has one, at the board's right: the
// values its preview computes, a field per property the edit whitelist allows,
// and what the last commit wrote. Typing previews in the guest; Enter commits
// one property and Escape takes its preview back.

import type { KeyboardEvent, Ref } from 'react';
import type { StyleKind } from './elementEditProtocol';
import type { SourceElement } from './protocol';
import type { ElementSelection } from './useElementEditor';
import { STYLE_PROPERTIES } from './styleProperties';

const GROUPS = (
  [
    ['typography', 'Text'],
    ['colour', 'Colour'],
    ['opacity', 'Opacity'],
    ['spacing', 'Spacing'],
    ['size', 'Size'],
    ['layout', 'Layout'],
  ] satisfies [StyleKind, string][]
).map(([kind, label]) => ({
  kind,
  label,
  properties: Object.keys(STYLE_PROPERTIES).filter(
    (property) => STYLE_PROPERTIES[property] === kind,
  ),
}));

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
    const previewed = Object.hasOwn(draft.values, property);
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit(property);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (previewed) onRevert(property);
      else onLeave();
    }
  };
  return (
    <div
      ref={ref}
      data-element-panel
      role="region"
      aria-label={`Styles of the selected ${draft.site.tagName}`}
      className="canvas-element-panel"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <p className="canvas-element-title">
        <span>{draft.site.tagName}</span> {fileName(draft.site.file)}
      </p>
      {!editable && <p className="canvas-element-note">{agentRoute(draft.site.editability)}</p>}
      {GROUPS.map(({ kind, label, properties }) => (
        <fieldset key={kind}>
          <legend>{label}</legend>
          {properties.map((property) => {
            const previewed = Object.hasOwn(draft.values, property);
            const value = previewed ? draft.values[property] : (shown.styles[property] ?? '');
            return (
              <label key={property} className="canvas-element-row">
                <span>{propertyLabel(property)}</span>
                <input
                  value={value}
                  title={value}
                  readOnly={readOnly}
                  spellCheck={false}
                  data-previewed={previewed || undefined}
                  onChange={(event) => {
                    onPreview(property, event.target.value);
                  }}
                  onKeyDown={(event) => {
                    onKeyDown(event, property);
                  }}
                />
              </label>
            );
          })}
        </fieldset>
      ))}
      <p role="status" className="canvas-element-note">
        {status(selection, editable)}
      </p>
    </div>
  );
}

/** Shared and computed sites are the agent's: one edit here could change what is not selected. */
function agentRoute(editability: SourceElement['editability']): string {
  return editability === 'shared'
    ? 'This element is written once and used in several places. Ask the agent to change it.'
    : 'This element’s styles are worked out in code. Ask the agent to change it.';
}

function status({ draft, written }: ElementSelection, editable: boolean): string {
  if (!editable) return '';
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
