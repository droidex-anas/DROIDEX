// Which of the Manage dialog's four tabs a kit token belongs to, and whether
// the dialog may paint with its value.

export type TokenTab = 'colors' | 'typography' | 'spacing' | 'shadows';
export type Token = [name: string, value: string];

export const TOKEN_TABS: { id: TokenTab; label: string }[] = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing', label: 'Spacing & Radius' },
  { id: 'shadows', label: 'Shadows' },
];

const COLOR_VALUE =
  /^(?:#[\da-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\)|transparent|white|black)$/i;

/** Motion and other tokens no tab shows are absent, never misfiled. */
export function tokensByTab(tokens: Record<string, string>): Record<TokenTab, Token[]> {
  const tabs: Record<TokenTab, Token[]> = { colors: [], typography: [], spacing: [], shadows: [] };
  for (const token of Object.entries(tokens).sort(([left], [right]) => left.localeCompare(right))) {
    const [name, value] = token;
    if (name.includes('shadow')) tabs.shadows.push(token);
    else if (COLOR_VALUE.test(value)) tabs.colors.push(token);
    else if (/font|text|leading|tracking|weight|letter|line-height/.test(name))
      tabs.typography.push(token);
    else if (/radius|rounded|space|spacing|gap|size/.test(name)) tabs.spacing.push(token);
  }
  return tabs;
}

/**
 * A value the dialog may paint with. Token values are validated CSS values,
 * but one that loads a resource would make the app fetch it, so it is shown
 * as text only.
 */
export function paintable(value: string): string | undefined {
  return /url\(|image\(|image-set\(/i.test(value) ? undefined : value;
}
