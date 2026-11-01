// The fonts a kit version embeds, which its document loads to set the kit's own
// words in its type. Only WOFF2 data a kit stylesheet holds reaches the
// renderer, so the document never fetches a font a kit names by URL.

import postcss, { CssSyntaxError, type AtRule } from 'postcss';
import { embeddedWoff2 } from './canvasFontAssets.js';
import { fontFamilies } from './designSystemAdherenceKit.js';
import type { DesignSystem } from './designSystems.js';

/** A kit rarely needs more than a few faces; past this the rest are left out. */
const MAX_KIT_FONT_FACES = 16;
const MAX_FONT_DESCRIPTOR_LENGTH = 1024;

/** One `@font-face` a kit declares, its descriptors as written and its WOFF2 file as base64. */
export interface KitFontFace {
  family: string;
  style: string;
  weight: string;
  unicodeRange: string;
  woff2: string;
}

/**
 * The first faces the kit's stylesheets embed, in path order. A face whose
 * source is not an embedded WOFF2 file, or whose descriptors are longer than
 * the bound, is left out, as is a stylesheet that does not parse.
 */
export function readKitFonts(system: DesignSystem): KitFontFace[] {
  const faces: KitFontFace[] = [];
  for (const path of Object.keys(system.files).sort()) {
    if (!path.endsWith('.css')) continue;
    try {
      postcss.parse(system.files[path]).walkAtRules('font-face', (rule) => {
        const face = fontFace(rule);
        if (face) faces.push(face);
      });
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
    }
  }
  return faces.slice(0, MAX_KIT_FONT_FACES);
}

function fontFace(rule: AtRule): KitFontFace | null {
  const descriptors = new Map<string, string>();
  rule.walkDecls((declaration) => {
    const value = declaration.value.trim();
    if (value !== '') descriptors.set(declaration.prop.toLowerCase(), value);
  });
  const family = fontFamilies(descriptors.get('font-family') ?? '').at(0);
  const woff2 = embeddedWoff2(descriptors.get('src') ?? '');
  if (family === undefined || woff2 === null) return null;
  const face = {
    family,
    style: descriptors.get('font-style') ?? 'normal',
    weight: descriptors.get('font-weight') ?? 'normal',
    unicodeRange: descriptors.get('unicode-range') ?? 'U+0-10FFFF',
  };
  if (Object.values(face).some((value) => value.length > MAX_FONT_DESCRIPTOR_LENGTH)) return null;
  return { ...face, woff2 };
}
