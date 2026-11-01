// The kit's typeface in its document: the fonts the kit embeds, loaded under
// names of the document's own so no other text in the app picks them up, and
// the kit's sans and heading stacks pointed at them. Until the fonts have
// loaded, and for a kit without font tokens, the document keeps the app's type.

import { useEffect, useState, type CSSProperties } from 'react';
import { canvasClient } from '../canvasClient';
import type { DocumentSection } from '../designSystemDocumentProtocol';
import type { KitFontFace } from '../protocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { tokensByName } from './documentSections';
import { isPaintable, modeValue } from './specimenStyle';

const APP_TYPE: CSSProperties = {};
let fontLoads = 0;

interface LoadedFonts {
  /** The kit version they came from. */
  key: string;
  /** The family each kit family loaded as, by the kit's name lowercased. */
  families: ReadonlyMap<string, string>;
}

/**
 * `--kit-body-font` and `--kit-heading-font` for the document's column, which
 * the `kit-body-font` and `kit-heading-font` classes read.
 */
export function useKitTypeface(
  kit: { id: string; version: number },
  sections: DocumentSection[],
  mode: PreviewMode,
): CSSProperties {
  const key = `${kit.id}@${String(kit.version)}`;
  const [loaded, setLoaded] = useState<LoadedFonts | null>(null);

  useEffect(() => {
    let live = true;
    let added: FontFace[] = [];
    const settle = (families: ReadonlyMap<string, string>) => {
      if (live) setLoaded({ key, families });
    };
    canvasClient.designSystems
      .readFonts({ id: kit.id, version: kit.version })
      .then(async (faces) => {
        if (!live) return;
        const families = documentFamilies(faces);
        added = faces.flatMap((face) => fontFace(face, families));
        for (const face of added) document.fonts.add(face);
        // A face the browser cannot read leaves its text to the stack's next family.
        await Promise.allSettled(added.map((face) => face.load()));
        settle(families);
      })
      // A kit whose fonts cannot be read keeps the stacks it names.
      .catch((error: unknown) => {
        console.error("A design system's fonts could not be read:", error);
        settle(new Map());
      });
    return () => {
      live = false;
      for (const face of added) document.fonts.delete(face);
    };
  }, [key, kit.id, kit.version]);

  if (loaded?.key !== key) return APP_TYPE;
  const tokens = tokensByName(sections);
  const stack = (name: string) => {
    const token = tokens.get(name)?.token;
    const value = token ? modeValue(token, mode).trim() : '';
    return isPaintable('font-family', value) ? withFamilies(value, loaded.families) : null;
  };
  const body = stack('--ds-font-sans');
  const heading = stack('--ds-font-heading') ?? body;
  const properties: Record<string, string> = {};
  if (body) properties['--kit-body-font'] = body;
  if (heading) properties['--kit-heading-font'] = heading;
  return properties;
}

function documentFamilies(faces: KitFontFace[]): Map<string, string> {
  fontLoads += 1;
  const families = new Map<string, string>();
  for (const { family } of faces) {
    const name = family.toLowerCase();
    if (!families.has(name))
      families.set(name, `droidex-kit-${String(fontLoads)}-${String(families.size)}`);
  }
  return families;
}

function fontFace(face: KitFontFace, families: ReadonlyMap<string, string>): FontFace[] {
  const family = families.get(face.family.toLowerCase());
  if (family === undefined) return [];
  try {
    const bytes = Uint8Array.from(atob(face.woff2), (character) => character.charCodeAt(0));
    return [
      new FontFace(family, bytes, {
        style: face.style,
        weight: face.weight,
        unicodeRange: face.unicodeRange,
      }),
    ];
  } catch {
    // Data or a descriptor the browser does not accept leaves the face out.
    return [];
  }
}

/** The stack with each family the kit embeds named as the document loaded it. */
function withFamilies(stack: string, families: ReadonlyMap<string, string>): string {
  return stack
    .split(',')
    .map((entry) => {
      const name = entry.trim().replace(/^(['"])(.*)\1$/, '$2');
      const loadedAs = families.get(name.toLowerCase());
      return loadedAs === undefined ? entry.trim() : `"${loadedAs}"`;
    })
    .join(', ');
}
