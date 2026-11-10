// The element panel's paint for an SVG shape, or for the svg that passes its
// own on to the shapes inside: a fill and a stroke from the kit's colour
// tokens or any colour, each one press from none and back, and the stroke's
// width while it has a stroke.

import type { ReactNode } from 'react';
import { Minus, Plus } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Labelled, Pair, Section } from './ElementPanelRows';

interface ElementVectorPaintProps {
  /** A property's value as the panel shows it: its preview, else what the preview computed. */
  value: (property: string) => string;
  disabled: boolean;
  /** Previews a picked value and commits it at once. */
  onPick: (property: string) => (value: string) => void;
  /** The panel's colour field for a property. */
  colour: (property: string, label: string) => ReactNode;
  /** The stroke width's field. */
  strokeWidth: ReactNode;
}

export function ElementVectorPaint({
  value,
  disabled,
  onPick,
  colour,
  strokeWidth,
}: ElementVectorPaintProps) {
  const paint = (property: 'fill' | 'stroke', label: string) => {
    const none = isNone(value(property));
    const name = label.toLowerCase();
    return (
      <Labelled label={label}>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{colour(property, label)}</div>
          {/* A new paint follows the text colour, as an icon's does. */}
          <Button
            variant="ghost"
            size="sm"
            icon={none ? Plus : Minus}
            aria-label={none ? `Add ${name}` : `Remove ${name}`}
            disabled={disabled}
            onClick={() => {
              onPick(property)(none ? 'currentColor' : 'none');
            }}
          />
        </div>
      </Labelled>
    );
  };
  return (
    <Section title="Vector">
      {paint('fill', 'Fill')}
      {paint('stroke', 'Stroke')}
      {!isNone(value('stroke')) && <Pair>{strokeWidth}</Pair>}
    </Section>
  );
}

function isNone(paint: string): boolean {
  return paint.trim().toLowerCase() === 'none';
}
