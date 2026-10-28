// Modal editor for custom theme presets. Edits apply to the whole window live
// (WYSIWYG) and are rolled back on cancel; saving hands the draft to the
// parent, which persists the preset and selects it.

import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, X, type IconComponent } from '@droidex/icons';
import { useStoreSelector } from '../hooks/useStore';
import { applyTheme, resolveScheme, type ThemeColors } from '../lib/theme';
import { ColorField } from './ColorPicker';
import { MiniAppFrame, ThemeSwatches } from './ThemePreview';
import { Button } from './ui/Button';
import { Dialog, DialogActions, DialogBody, DialogTitle } from './ui/Dialog';
import { Field, Input } from './ui/Field';

export interface ThemeDraft {
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
}

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; description: string }[] = [
  { key: 'accent', label: 'Accent', description: 'Highlights, active states, send button' },
  { key: 'bg', label: 'App background', description: 'The main window behind everything' },
  { key: 'fg', label: 'Text color', description: 'Default color for all text' },
  { key: 'surface', label: 'Panel background', description: 'Sidebar, cards and raised surfaces' },
  { key: 'border', label: 'Borders', description: 'Dividers and outlines between sections' },
];

export function ThemeEditor({
  title,
  initial,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  initial: ThemeDraft;
  /** Save/persistence failure from the parent; the dialog stays open so the
   * user can retry. */
  error?: string | null;
  /** Returns true when the draft was persisted; false keeps the dialog open
   * (and cancelable with rollback) so the preview is never mistaken for a
   * saved theme. */
  onSave: (draft: ThemeDraft) => boolean;
  onCancel: () => void;
}) {
  const theme = useStoreSelector((state) => state.theme);
  // The store theme is never dispatched while the editor is open, but an
  // external update (e.g. an OS scheme change) can still land, so track the
  // latest store theme: cancel restores it instead of a stale open-time
  // snapshot.
  const latestTheme = useRef(theme);
  useEffect(() => {
    latestTheme.current = theme;
  });
  const savedRef = useRef(false);
  const [draft, setDraft] = useState<ThemeDraft>(initial);
  // Resolve System mode so the editor opens on the variant actually on screen.
  const [editing, setEditing] = useState<'light' | 'dark'>(() => resolveScheme(theme.mode));

  // Live-preview the variant being edited across the whole app.
  useEffect(() => {
    applyTheme({ ...theme, ...draft[editing] });
  }, [theme, draft, editing]);

  useEffect(() => {
    return () => {
      if (!savedRef.current) applyTheme(latestTheme.current);
    };
  }, []);

  // While the app is in System mode, keep the edited variant on the one the OS
  // actually shows; otherwise a scheme flip mid-edit leaves the preview on
  // stale colors (App dispatches the new variant, but draft[editing] would
  // keep overriding it with the variant selected at open time).
  useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      setEditing(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [theme.mode]);

  const nameRef = useRef<HTMLInputElement>(null);

  const setColor = (key: keyof ThemeColors, value: string) => {
    setDraft((d) => ({ ...d, [editing]: { ...d[editing], [key]: value } }));
  };

  const name = draft.name.trim();
  const save = () => {
    if (!name) return;
    // Latch "saved" only when the parent confirms persistence — otherwise a
    // failed save followed by Cancel would skip the rollback and leave the
    // unsaved preview palette applied with no state behind it.
    if (onSave({ ...draft, name })) savedRef.current = true;
  };

  return (
    <Dialog size="form" onClose={onCancel} initialFocusRef={nameRef}>
      <div className="flex items-center justify-between gap-4">
        <DialogTitle>{title}</DialogTitle>
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          onClick={onCancel}
          aria-label="Close theme editor"
          className="-mr-2"
        />
      </div>

      <DialogBody>
        {/* Live preview: wireframe plus the theme's icon glyph */}
        <div className="relative h-44 overflow-hidden rounded-lg">
          <MiniAppFrame colors={draft[editing]} />
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-bg/70 p-3 shadow-sm backdrop-blur-sm">
            <ThemeSwatches
              preset={{
                id: 'draft',
                name: draft.name || 'Draft',
                light: draft.light,
                dark: draft.dark,
              }}
              scheme={editing}
              size={36}
            />
          </div>
          <div className="absolute right-2 top-2 flex gap-0.5 rounded-md bg-bg/80 p-0.5 shadow-sm backdrop-blur-sm">
            <VariantToggle
              icon={Sun}
              label="Light"
              selected={editing === 'light'}
              onSelect={() => {
                setEditing('light');
              }}
            />
            <VariantToggle
              icon={Moon}
              label="Dark"
              selected={editing === 'dark'}
              onSelect={() => {
                setEditing('dark');
              }}
            />
          </div>
        </div>

        <Field label="Theme name" className="mt-4">
          <Input
            ref={nameRef}
            maxLength={60}
            value={draft.name}
            onChange={(e) => {
              setDraft((d) => ({ ...d, name: e.target.value }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
            }}
            placeholder="My theme"
            spellCheck={false}
          />
        </Field>

        <div className="mt-4 space-y-3">
          {COLOR_FIELDS.map(({ key, label, description }) => (
            <ColorField
              key={`${editing}-${key}`}
              label={`${label} · ${editing}`}
              description={description}
              value={draft[editing][key]}
              onChange={(v) => {
                setColor(key, v);
              }}
            />
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-body text-danger">
            {error}
          </p>
        )}
      </DialogBody>

      <DialogActions>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!name}>
          Save theme
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function VariantToggle({
  icon,
  label,
  selected,
  onSelect,
}: {
  icon: IconComponent;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      title={`Edit ${label.toLowerCase()} variant`}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex h-control-sm items-center gap-1.5 rounded-sm px-2 text-label transition-colors ${
        selected ? 'bg-elevated text-primary' : 'text-muted hover:text-primary'
      }`}
    >
      <Icon className="size-icon-sm" aria-hidden="true" />
      {label}
    </button>
  );
}
