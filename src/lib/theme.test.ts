import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_THEMES,
  SKILL_COLORS,
  ULTRA_COLORS,
  UPDATE_COLORS,
  contrastRatio,
  CUSTOM_THEME_ID,
  DEFAULT_THEME,
  detectPresetId,
  elevatedSurfaceColor,
  newCustomThemeId,
  parseCustomThemes,
  parseThemePresetImport,
  relativeLuminance,
  removeCustomTheme,
  resolveVariant,
  statusColorOnLight,
  surfaceStep,
  upsertCustomTheme,
  type ThemePreset,
} from './theme';

const EXAMPLE_CUSTOM: ThemePreset = {
  id: 'custom-test',
  name: 'Test Theme',
  light: { bg: '#f0f0f0', fg: '#101010', surface: '#ffffff', border: '#dddddd', accent: '#181818' },
  dark: { bg: '#101010', fg: '#f0f0f0', surface: '#181818', border: '#282828', accent: '#e8e8e8' },
};

describe('BUILT_IN_THEMES', () => {
  it('keeps every variant of every preset on valid 6-digit hex colors', () => {
    for (const preset of BUILT_IN_THEMES) {
      for (const variant of [preset.light, preset.dark]) {
        for (const value of Object.values(variant)) {
          assert.match(value, /^#[0-9a-f]{6}$/i, `${preset.id} has an invalid color`);
        }
      }
    }
  });

  it('has unique ids and a default theme', () => {
    const ids = BUILT_IN_THEMES.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(DEFAULT_THEME.id, 'droid');
  });

  it('light canvases are soft off-whites with surfaces above them', () => {
    for (const preset of BUILT_IN_THEMES) {
      const { bg, surface } = preset.light;
      assert.ok(
        relativeLuminance(bg) < 0.96,
        `${preset.id} light bg ${bg} should sit below pure white`,
      );
      assert.ok(
        relativeLuminance(surface) > relativeLuminance(bg),
        `${preset.id} surfaces must lift above the canvas`,
      );
    }
  });

  it('keeps foreground text comfortably readable on every variant', () => {
    // Softened (non-black) foregrounds are intentional, but they must stay well
    // above WCAG AA's 4.5:1 for normal text on both canvas and raised surfaces.
    for (const preset of BUILT_IN_THEMES) {
      for (const variant of [preset.light, preset.dark]) {
        for (const surface of [variant.bg, variant.surface]) {
          assert.ok(
            contrastRatio(variant.fg, surface) >= 7,
            `${preset.id} fg ${variant.fg} on ${surface} should reach 7:1`,
          );
        }
      }
    }
  });

  it('keeps accent-colored text at WCAG AA on every variant', () => {
    // Accents appear as text (links, active labels), so each must reach 4.5:1
    // for normal text on both the canvas and raised surfaces of its variant.
    for (const preset of BUILT_IN_THEMES) {
      for (const variant of [preset.light, preset.dark]) {
        for (const surface of [variant.bg, variant.surface]) {
          assert.ok(
            contrastRatio(variant.accent, surface) >= 4.5,
            `${preset.id} accent ${variant.accent} on ${surface} should reach 4.5:1`,
          );
        }
      }
    }
  });
});

describe('statusColorOnLight', () => {
  it('keeps light status text at WCAG AA on every preset canvas', () => {
    for (const preset of BUILT_IN_THEMES) {
      for (const tuned of ['#1f7a4d', '#9a5a0f']) {
        const shade = statusColorOnLight(tuned, preset.light.bg);
        assert.ok(
          contrastRatio(shade, preset.light.bg) >= 4.5,
          `${preset.id} status ${shade} on ${preset.light.bg} should reach 4.5:1`,
        );
      }
    }
  });

  it('returns a shade that already reads on its canvas untouched', () => {
    const { bg } = DEFAULT_THEME.light;
    assert.equal(statusColorOnLight('#1f7a4d', bg), '#1f7a4d');
    assert.equal(statusColorOnLight('#9a5a0f', bg), '#9a5a0f');
  });
});

describe('custom theme list helpers', () => {
  it('upsert appends or replaces by id without mutating the input; remove drops only that id', () => {
    const list = [EXAMPLE_CUSTOM];
    const appended = upsertCustomTheme(list, { ...EXAMPLE_CUSTOM, id: 'custom-two' });
    assert.deepEqual(
      appended.map((p) => p.id),
      ['custom-test', 'custom-two'],
    );
    const replaced = upsertCustomTheme(list, { ...EXAMPLE_CUSTOM, name: 'Renamed' });
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].name, 'Renamed');
    assert.equal(list[0].name, 'Test Theme');

    assert.deepEqual(
      removeCustomTheme(appended, 'custom-test').map((p) => p.id),
      ['custom-two'],
    );
    assert.equal(removeCustomTheme(appended, 'nope').length, 2);
  });
});

describe('resolveVariant', () => {
  it('falls back to the dark variant for system when no preference is readable', () => {
    // node:test has no window, so matchMedia is unavailable.
    assert.equal(resolveVariant(DEFAULT_THEME, 'system'), DEFAULT_THEME.dark);
  });
});

describe('detectPresetId', () => {
  it('matches built-in and custom variants exactly, ignoring hex case, else reports custom', () => {
    assert.equal(detectPresetId({ ...DEFAULT_THEME.dark }), DEFAULT_THEME.id);
    assert.equal(detectPresetId({ ...BUILT_IN_THEMES[1].light }), BUILT_IN_THEMES[1].id);
    const upper = { ...DEFAULT_THEME.dark, bg: DEFAULT_THEME.dark.bg.toUpperCase() };
    assert.equal(detectPresetId(upper), DEFAULT_THEME.id);
    assert.equal(detectPresetId({ ...EXAMPLE_CUSTOM.dark }, [EXAMPLE_CUSTOM]), EXAMPLE_CUSTOM.id);
    assert.equal(
      detectPresetId({ ...DEFAULT_THEME.dark, accent: '#ee6018' }, [EXAMPLE_CUSTOM]),
      CUSTOM_THEME_ID,
    );
  });
});

describe('surfaceStep', () => {
  it('lifts every raised rung clear of the canvas in both schemes', () => {
    // Light presets put their surface above the canvas, so the rungs step
    // darker. Measuring them from the surface used to land the first one back
    // on the canvas, which hid popovers, menus and fields in light mode.
    for (const preset of BUILT_IN_THEMES) {
      for (const variant of [preset.light, preset.dark]) {
        const elevated = surfaceStep(variant, 13);
        const active = surfaceStep(variant, 26);
        for (const [rung, name] of [
          [elevated, 'elevated'],
          [active, 'active'],
        ] as const) {
          for (const base of [variant.bg, variant.surface]) {
            assert.ok(
              contrastRatio(rung, base) >= 1.05,
              `${preset.id} ${name} ${rung} should stay visible on ${base}`,
            );
          }
        }
        assert.ok(
          contrastRatio(active, elevated) >= 1.05,
          `${preset.id} active ${active} should stay visible on elevated ${elevated}`,
        );
      }
    }
  });
});

describe('fixed label colors', () => {
  it('keeps skill and ultra labels WCAG AA readable on every built-in raised surface', () => {
    for (const preset of BUILT_IN_THEMES) {
      for (const scheme of ['light', 'dark'] as const) {
        const elevated = elevatedSurfaceColor(preset[scheme]);
        assert.ok(
          contrastRatio(SKILL_COLORS[scheme], elevated) >= 4.5,
          `${preset.id} ${scheme} skill label should reach 4.5:1`,
        );
        assert.ok(
          contrastRatio(ULTRA_COLORS[scheme], elevated) >= 4.5,
          `${preset.id} ${scheme} ultra label should reach 4.5:1`,
        );
      }
    }
  });

  it('keeps the update pill label readable on both of its blues', () => {
    for (const blue of [UPDATE_COLORS.base, UPDATE_COLORS.hover]) {
      assert.ok(
        contrastRatio('#ffffff', blue) >= 4.5,
        `update pill label should reach 4.5:1 on ${blue}`,
      );
    }
  });
});

describe('parseCustomThemes', () => {
  it('drops malformed entries, blank names, and non-array payloads, trimming names', () => {
    assert.deepEqual(parseCustomThemes(null), []);
    assert.deepEqual(parseCustomThemes('nope'), []);
    assert.deepEqual(
      parseCustomThemes([
        EXAMPLE_CUSTOM,
        { id: 'x', name: 'Missing variants' },
        { id: '', name: 'No id', light: EXAMPLE_CUSTOM.light, dark: EXAMPLE_CUSTOM.dark },
        {
          id: 'y',
          name: 'Bad hex',
          light: { ...EXAMPLE_CUSTOM.light, bg: 'red' },
          dark: EXAMPLE_CUSTOM.dark,
        },
        null,
      ]),
      [EXAMPLE_CUSTOM],
    );
    const [parsed] = parseCustomThemes([{ ...EXAMPLE_CUSTOM, name: '  Padded  ' }]);
    assert.equal(parsed.name, 'Padded');
    assert.deepEqual(parseCustomThemes([{ ...EXAMPLE_CUSTOM, name: '   ' }]), []);
  });
});

describe('parseThemePresetImport', () => {
  it('accepts a valid export payload and rejects incomplete ones', () => {
    const payload = {
      name: EXAMPLE_CUSTOM.name,
      light: EXAMPLE_CUSTOM.light,
      dark: EXAMPLE_CUSTOM.dark,
    };
    assert.deepEqual(parseThemePresetImport(payload), payload);
    assert.equal(parseThemePresetImport(null), null);
    assert.equal(parseThemePresetImport({ name: 'x' }), null);
    assert.equal(
      parseThemePresetImport({ name: 'x', light: EXAMPLE_CUSTOM.light, dark: { bg: '#000000' } }),
      null,
    );
  });
});

describe('newCustomThemeId', () => {
  it('generates unique custom-prefixed ids', () => {
    const a = newCustomThemeId();
    const b = newCustomThemeId();
    assert.match(a, /^custom-/);
    assert.notEqual(a, b);
  });
});
