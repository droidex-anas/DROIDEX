// Settings → Keyboard. One row per rebindable app action; the bindings
// themselves live in lib/shortcuts.

import { useEffect, useState } from 'react';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import {
  PRIMARY_MODIFIER_LABEL,
  SHORTCUT_DEFINITIONS,
  chordFromEvent,
  conflictingActions,
  defaultChordFor,
  formatChord,
  serializeChord,
  type ShortcutAction,
} from '../lib/shortcuts';
import { SectionTitle, SettingRow } from './settingsKit';
import { Button } from './ui/Button';

export function KeyboardShortcutsSettings() {
  const dispatch = useStoreDispatch();
  const bindings = useStoreSelector((state) => state.shortcutBindings);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    // Capture phase on window: the chord being recorded must not reach the
    // app's own shortcut handler or the settings panel's Escape listener.
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        dispatch({
          type: 'SET_SHORTCUT_BINDING',
          shortcut: capturing,
          chord: defaultChordFor(capturing),
        });
        setCapturing(null);
        return;
      }
      const chord = chordFromEvent(event);
      // Keep listening for modifier-only presses, and for chords the window
      // handler could never see: it ignores anything without the primary
      // modifier so plain typing stays plain typing.
      if (!chord?.meta) return;
      dispatch({ type: 'SET_SHORTCUT_BINDING', shortcut: capturing, chord: serializeChord(chord) });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [capturing, dispatch]);

  return (
    <div className="mx-auto max-w-2xl">
      <SectionTitle
        title="Keyboard"
        sub={`Press a new chord after choosing Change. Escape cancels, Delete restores the default. Every shortcut needs ${PRIMARY_MODIFIER_LABEL}.`}
      />
      <div className="divide-y divide-divider overflow-hidden rounded-xl bg-surface shadow-lg">
        {SHORTCUT_DEFINITIONS.map((definition) => {
          const active = capturing === definition.action;
          const conflicts = conflictingActions(bindings, definition.action);
          return (
            <SettingRow
              key={definition.action}
              label={definition.label}
              description={
                conflicts.length > 0 ? (
                  <span className="text-warning">
                    Also bound to {conflicts.map((other) => other.label).join(', ')}.
                  </span>
                ) : undefined
              }
            >
              <div className="flex shrink-0 items-center gap-2">
                <kbd
                  className={`min-w-12 rounded-sm px-2 py-1 text-center font-mono text-code-sm ${
                    active ? 'bg-active text-primary' : 'bg-elevated text-muted'
                  }`}
                >
                  {active ? 'Press…' : formatChord(bindings[definition.action])}
                </kbd>
                <Button
                  size="sm"
                  aria-label={
                    active
                      ? `Cancel changing the ${definition.label.toLowerCase()} shortcut`
                      : `Change the ${definition.label.toLowerCase()} shortcut`
                  }
                  onClick={() => {
                    setCapturing(active ? null : definition.action);
                  }}
                >
                  {active ? 'Cancel' : 'Change'}
                </Button>
              </div>
            </SettingRow>
          );
        })}
        {/* Browser tab numbering is fixed, so it is listed but not rebindable. */}
        <SettingRow label="Go to tab 1–9" description="9 always opens the last tab.">
          <kbd className="min-w-12 shrink-0 rounded-sm bg-elevated px-2 py-1 text-center font-mono text-code-sm text-muted">
            {formatChord('Meta+1')}–{formatChord('Meta+9')}
          </kbd>
        </SettingRow>
      </div>
    </div>
  );
}
