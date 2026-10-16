// The theme preset card: header with the preset dropdown and Import, one row
// per palette color (solid pill swatch + hex that opens the picker popover),
// quick accents, and a footer with the preset actions (new, duplicate, and —
// for custom themes — edit, export, delete). Manual color edits detach from
// the active preset into an unsaved custom look until saved as a theme.

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Pencil, Plus, Trash, Upload } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { persistCustomThemes, type ThemeConfig } from '../hooks/persistedThemePreferences';
import {
  applyTheme,
  BUILT_IN_THEMES,
  CUSTOM_THEME_ID,
  DEFAULT_THEME,
  findPreset,
  newCustomThemeId,
  parseThemePresetImport,
  removeCustomTheme,
  resolveVariant,
  upsertCustomTheme,
  type ThemeColors,
  type ThemePreset,
} from '../lib/theme';
import { contrastRatio } from '../lib/themeTokens';
import { ColorPicker, ColorPopover } from './ColorPicker';
import { Dropdown } from './settingsKit';
import { ThemeEditor, type ThemeDraft } from './ThemeEditor';
import { ThemeSwatches } from './ThemePreview';
import { Button } from './ui/Button';

const QUICK_ACCENTS = [
  '#ee6018',
  '#ef6f2e',
  '#d15010',
  '#e8a838',
  '#4a9e7a',
  '#4ecdc4',
  '#7a8aaa',
  '#a78bfa',
  '#f87171',
  '#fcfcfc',
];

const COLOR_ROWS: { key: keyof ThemeColors; label: string; description: string }[] = [
  {
    key: 'accent',
    label: 'Accent',
    description: 'Highlights, active states, send button & design-mode controls',
  },
  { key: 'bg', label: 'App background', description: 'The main window behind everything' },
  { key: 'fg', label: 'Text color', description: 'Default color for all text' },
  { key: 'surface', label: 'Panel background', description: 'Sidebar, cards and raised surfaces' },
  { key: 'border', label: 'Borders', description: 'Dividers and outlines between sections' },
];

type EditorState =
  | { kind: 'create'; draft: ThemeDraft }
  | { kind: 'edit'; id: string; draft: ThemeDraft };

// Ink (near-black or near-white) with the better contrast against a filled
// pill/swatch — shared by the color rows and the quick-accent checks so the
// rule stays in one place.
const contrastInk = (value: string): string =>
  contrastRatio(value, '#101010') >= contrastRatio(value, '#f7f7f7') ? '#101010' : '#f7f7f7';

/** One color row: label on the left, solid pill (ring dot + hex) on the right. */
function ThemeColorRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  // The pill is filled with the color itself; the hex picks whichever ink
  // (near-black or near-white) has better contrast against it.
  const ink = contrastInk(value);
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <div className="text-body text-primary">{label}</div>
        <div className="text-caption text-muted">{description}</div>
      </div>
      <button
        ref={pillRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        title={`Pick ${label.toLowerCase()}`}
        className="flex h-control-md min-w-32 shrink-0 items-center gap-2 rounded-md px-2.5 font-mono text-code-sm transition duration-150 ease-out hover:opacity-90 active:scale-97"
        style={{
          backgroundColor: value,
          color: ink,
          boxShadow: 'inset 0 0 0 1px rgba(128, 128, 128, 0.3)',
        }}
      >
        <span
          className="size-icon-sm shrink-0 rounded-full"
          style={{ boxShadow: `inset 0 0 0 1.5px ${ink}` }}
        />
        {value}
      </button>
      {open && (
        <ColorPopover
          anchorRef={pillRef}
          onClose={() => {
            setOpen(false);
          }}
        >
          <ColorPicker value={value} onChange={onChange} />
        </ColorPopover>
      )}
    </div>
  );
}

export function ThemePresetCard({ resolvedScheme }: { resolvedScheme: 'light' | 'dark' }) {
  const dispatch = useStoreDispatch();
  const { theme, customThemes } = useStoreSelector(
    (state) => ({ theme: state.theme, customThemes: state.customThemes }),
    shallowEqual,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activePreset = findPreset(theme.presetId, customThemes);
  const activeIsCustom = activePreset ? customThemes.some((p) => p.id === activePreset.id) : false;
  // Palette behind previews: the active preset, or the default when the
  // current colors are hand-edited and match no preset.
  const previewPreset = activePreset ?? DEFAULT_THEME;

  const updateTheme = (patch: Partial<ThemeConfig>) => {
    dispatch({ type: 'SET_THEME', theme: patch });
    applyTheme({ ...theme, ...patch });
  };

  const selectTheme = (preset: ThemePreset) => {
    setDeleteArmed(false);
    updateTheme({ presetId: preset.id, ...resolveVariant(preset, theme.mode) });
  };

  // Manual color edits detach from the preset: the look becomes unsaved custom
  // colors until the user saves them as a theme.
  const updateColors = (patch: Partial<ThemeColors>) => {
    updateTheme({ ...patch, presetId: CUSTOM_THEME_ID });
  };

  const currentColors = (): ThemeColors => ({
    bg: theme.bg,
    fg: theme.fg,
    surface: theme.surface,
    border: theme.border,
    accent: theme.accent,
  });

  /* ── editor flows ── */
  const openEditor = (next: EditorState) => {
    // A fresh flow must not show a previous import/save failure; only a
    // failed save retry sets it again.
    setThemeError(null);
    setEditor(next);
  };
  const closeEditor = () => {
    setEditor(null);
  };
  const openNewTheme = () => {
    openEditor({
      kind: 'create',
      draft: { name: '', light: { ...previewPreset.light }, dark: { ...previewPreset.dark } },
    });
  };
  const openSaveCurrentAs = () => {
    const draft: ThemeDraft = {
      name: '',
      light: { ...previewPreset.light },
      dark: { ...previewPreset.dark },
    };
    draft[resolvedScheme] = currentColors();
    openEditor({ kind: 'create', draft });
  };
  const openDuplicate = (p: ThemePreset) => {
    openEditor({
      kind: 'create',
      draft: { name: `${p.name} copy`, light: { ...p.light }, dark: { ...p.dark } },
    });
  };
  const openEdit = (p: ThemePreset) => {
    openEditor({
      kind: 'edit',
      id: p.id,
      draft: { name: p.name, light: { ...p.light }, dark: { ...p.dark } },
    });
  };

  // Persist BEFORE dispatching (the reducer is pure; a throw there would
  // surface during render and unmount the app). On a storage failure we keep
  // state untouched and show a retryable error — the editor stays open.
  const persistThemes = (next: ThemePreset[], failure: string): boolean => {
    try {
      persistCustomThemes(next);
      setThemeError(null);
      return true;
    } catch {
      setThemeError(failure);
      return false;
    }
  };

  const handleSave = (draft: ThemeDraft): boolean => {
    const id = editor?.kind === 'edit' ? editor.id : newCustomThemeId();
    // Clamp to the persisted limit (readPresetName truncates at 60) so the
    // name shown now matches what survives a restart.
    const preset: ThemePreset = {
      id,
      name: draft.name.slice(0, 60),
      light: draft.light,
      dark: draft.dark,
    };
    if (
      !persistThemes(
        upsertCustomTheme(customThemes, preset),
        'Could not save the theme — browser storage is unavailable. Fix that and try again.',
      )
    )
      return false;
    dispatch({ type: 'SAVE_CUSTOM_THEME', preset });
    updateTheme({ presetId: id, ...resolveVariant(preset, theme.mode) });
    closeEditor();
    return true;
  };

  const handleDelete = (p: ThemePreset) => {
    if (
      !persistThemes(
        removeCustomTheme(customThemes, p.id),
        'Could not delete the theme — browser storage is unavailable. Fix that and try again.',
      )
    )
      return;
    dispatch({ type: 'DELETE_CUSTOM_THEME', id: p.id });
    // Deleting the active theme falls back to the default so presetId never
    // dangles.
    if (theme.presetId === p.id) {
      updateTheme({ presetId: DEFAULT_THEME.id, ...resolveVariant(DEFAULT_THEME, theme.mode) });
    }
  };

  // Delete is a two-click confirm: the first click arms the button for a few
  // seconds, the second actually deletes.
  useEffect(() => {
    if (!deleteArmed) return;
    const timer = window.setTimeout(() => {
      setDeleteArmed(false);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deleteArmed]);

  /* ── export / import ── */
  const exportTheme = (p: ThemePreset) => {
    const payload = { name: p.name, light: p.light, dark: p.dark };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'theme'}.theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parseThemePresetImport(JSON.parse(await file.text()));
      if (!parsed) {
        setThemeError('That file is not a valid theme export.');
        return;
      }
      // Open the editor so the import is previewed and named before saving.
      openEditor({ kind: 'create', draft: parsed });
    } catch {
      setThemeError('Could not read that file — expected a JSON theme export.');
    }
  };

  const allPresets = [...BUILT_IN_THEMES, ...customThemes];
  const unsavedColors = activePreset ? null : currentColors();
  const themeOptions = [
    // Hand-tuned colors that match no preset show up as an unsaved custom
    // entry so the dropdown always reflects what is on screen.
    ...(unsavedColors
      ? [
          {
            value: CUSTOM_THEME_ID,
            label: 'Custom (unsaved)',
            icon: (
              <ThemeSwatches
                preset={{
                  id: CUSTOM_THEME_ID,
                  name: 'Custom',
                  light: unsavedColors,
                  dark: unsavedColors,
                }}
                scheme={resolvedScheme}
                size={20}
              />
            ),
          },
        ]
      : []),
    ...allPresets.map((p) => ({
      value: p.id,
      label: p.name,
      icon: <ThemeSwatches preset={p} scheme={resolvedScheme} size={20} />,
    })),
  ];

  return (
    <div className="mb-8 rounded-xl bg-surface shadow-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="text-body-strong text-primary">
          {resolvedScheme === 'dark' ? 'Dark' : 'Light'} theme
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={Upload}
            onClick={() => {
              importInputRef.current?.click();
            }}
          >
            Import
          </Button>
          <Dropdown
            ariaLabel="Theme preset"
            value={theme.presetId}
            width="w-48"
            options={themeOptions}
            onChange={(id) => {
              if (id === CUSTOM_THEME_ID) return;
              const preset = findPreset(id, customThemes);
              if (preset) selectTheme(preset);
            }}
          />
        </div>
      </div>
      {themeError && (
        <p role="alert" className="px-4 pb-2.5 text-body text-danger">
          {themeError}
        </p>
      )}

      <div className="px-4">
        {COLOR_ROWS.map(({ key, label, description }) => (
          <ThemeColorRow
            key={key}
            label={label}
            description={description}
            value={theme[key]}
            onChange={(v) => {
              updateColors({ [key]: v });
            }}
          />
        ))}
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <div className="text-body text-primary">Quick accents</div>
            <div className="text-caption text-muted">One-tap accent colors</div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {QUICK_ACCENTS.map((c) => {
              const selected = theme.accent.toLowerCase() === c.toLowerCase();
              // The check sits on the swatch itself (a white check vanishes on
              // the near-white accent).
              const ink = contrastInk(c);
              return (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={`Accent ${c}`}
                  aria-pressed={selected}
                  onClick={() => {
                    updateColors({ accent: c });
                  }}
                  className="flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                  // A hairline keeps a swatch the colour of the panel (white on
                  // a light theme) from reading as an empty slot.
                  style={{ backgroundColor: c, boxShadow: 'inset 0 0 0 1px var(--divider)' }}
                >
                  {selected && <Check className="size-icon-sm" style={{ color: ink }} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={Plus} onClick={openNewTheme}>
            New theme
          </Button>
          {activePreset && (
            <Button
              variant="ghost"
              size="sm"
              icon={Copy}
              onClick={() => {
                openDuplicate(activePreset);
              }}
            >
              Duplicate
            </Button>
          )}
          {activeIsCustom && activePreset && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                onClick={() => {
                  openEdit(activePreset);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Download}
                onClick={() => {
                  exportTheme(activePreset);
                }}
              >
                Export
              </Button>
              <Button
                variant={deleteArmed ? 'danger' : 'ghost'}
                size="sm"
                icon={Trash}
                onClick={() => {
                  if (!deleteArmed) {
                    setDeleteArmed(true);
                    return;
                  }
                  setDeleteArmed(false);
                  handleDelete(activePreset);
                }}
              >
                {deleteArmed ? 'Click again to delete' : 'Delete'}
              </Button>
            </>
          )}
        </div>
        {!activePreset && (
          <Button variant="ghost" size="sm" icon={Plus} onClick={openSaveCurrentAs}>
            Save as theme…
          </Button>
        )}
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void handleImportFile(e);
        }}
      />
      {editor && (
        <ThemeEditor
          title={editor.kind === 'edit' ? 'Edit theme' : 'New theme'}
          initial={editor.draft}
          error={themeError}
          onSave={handleSave}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
}
