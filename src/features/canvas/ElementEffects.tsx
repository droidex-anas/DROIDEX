// The element panel's Effects section: shadows from the kit's tokens, and a
// layer blur and a background blur from the kit's blur tokens or Tailwind's
// stock steps, each previewed as a list rests on it and applied as it is
// picked, then the fields the panel adds.

import type { ReactNode } from 'react';
import { BLUR_STEPS } from './elementPanelChoices';
import { Labelled, Section } from './ElementPanelRows';
import { blurOf, isOpaque } from './panelValues';
import { ShadowRows } from './ShadowRows';
import { ValuePickerField, type ValueOption } from './ValuePickerField';

interface ElementEffectsProps {
  /** A property's value as the panel shows it: its preview, else what the preview computed. */
  value: (property: string) => string;
  /** A property's kit tokens as picker options; undefined until they load. */
  tokenOptions: (property: string) => ValueOption[] | undefined;
  disabled: boolean;
  /** Previews a picked value and commits it at once. */
  onPick: (property: string) => (value: string) => void;
  /** Previews the option a list rests on; null puts back what was there. */
  onHover: (property: string) => (value: string | null) => void;
  /** The fields after the pickers. */
  children: ReactNode;
}

export function ElementEffects({
  value,
  tokenOptions,
  disabled,
  onPick,
  onHover,
  children,
}: ElementEffectsProps) {
  const backdrop = blurOf(value('backdropFilter'));
  // A previewed fill token is named, not a colour; its option holds the colour.
  const fill = value('backgroundColor');
  const fillColour = tokenOptions('backgroundColor')?.find((option) => option.value === fill)?.hint;
  const blurPicker = (property: string, label: string, current: string) => (
    <ValuePickerField
      label={label}
      options={[...(tokenOptions(property) ?? []), ...BLUR_STEPS]}
      value={current}
      disabled={disabled}
      onPick={onPick(property)}
      onActive={onHover(property)}
    />
  );
  return (
    <Section title="Effects">
      <ShadowRows
        shadow={value('boxShadow')}
        options={tokenOptions('boxShadow')}
        disabled={disabled}
        onPick={onPick('boxShadow')}
        onHover={onHover('boxShadow')}
      />
      <Labelled label="Blur">
        {blurPicker('filter', 'Layer blur', blurOf(value('filter')))}
      </Labelled>
      <Labelled
        label="Backdrop"
        // The fill paints over the blurred backdrop, so only a see-through one shows it.
        note={
          backdrop !== 'none' &&
          isOpaque(fillColour ?? fill) &&
          'The fill is opaque, so this blur does not show.'
        }
      >
        {blurPicker('backdropFilter', 'Background blur', backdrop)}
      </Labelled>
      {children}
    </Section>
  );
}
