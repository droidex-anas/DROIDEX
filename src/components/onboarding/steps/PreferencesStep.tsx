import { useEffect, useState } from 'react';
import { ArrowLeft } from '@droidex/icons';

import type { OnboardingController } from '../../../hooks/useOnboarding';
import {
  EDITOR_OPTIONS,
  getDefaultEditor,
  normalizeEditorId,
  setDefaultEditor,
  type EditorId,
} from '../../../lib/editorOpen';
import { listEditors } from '../../../lib/desktop';
import { EditorIcon } from '../../EditorIcon';
import { SettingRow } from '../../settingsKit';
import { Switch } from '../../Switch';
import { Button } from '../../ui/Button';
import { Panel, StepLabel, StepTitle } from '../kit';

export function PreferencesStep({
  controller,
  onNext,
  onBack,
}: {
  controller: OnboardingController;
  onNext: () => void;
  onBack: () => void;
}) {
  const [editors, setEditors] = useState<EditorId[]>([]);
  // Prefer onboarding state, then any previously saved default editor, so a
  // returning user's Cursor/Finder/Terminal choice isn't reset to VS Code.
  const [editor, setEditor] = useState<EditorId>(
    controller.onboarding?.defaultEditor === undefined
      ? getDefaultEditor()
      : normalizeEditorId(controller.onboarding.defaultEditor),
  );
  const [cliAuto, setCliAuto] = useState(controller.onboarding?.cliAutoUpdate ?? true);
  const [appAuto, setAppAuto] = useState(controller.onboarding?.appAutoUpdate ?? true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void listEditors().then((ids) => {
      setEditors(ids);
      if (ids.length && !ids.includes(editor)) setEditor(ids[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editorOptions = EDITOR_OPTIONS.filter((o) => editors.includes(o.id));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await controller.patch({
        defaultEditor: editor,
        cliAutoUpdate: cliAuto,
        appAutoUpdate: appAuto,
      });
      setDefaultEditor(editor);
      onNext();
    } catch {
      setSaveError("Couldn't save your preferences. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepLabel>Preferences</StepLabel>
      <StepTitle
        title="Make it yours."
        sub="Set your defaults. Existing Droid settings are imported automatically, and all of this can change later."
      />

      <Panel className="mb-7 py-1">
        <div className="px-4 py-3">
          <div className="mb-2.5 text-body text-primary">Default editor</div>
          <div className="flex flex-wrap gap-2">
            {editorOptions.length === 0 && (
              <span className="text-caption text-muted">No editors detected.</span>
            )}
            {editorOptions.map((o) => (
              <Button
                key={o.id}
                aria-pressed={editor === o.id}
                disabled={saving}
                onClick={() => {
                  setEditor(o.id);
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <EditorIcon editor={o.id} size={16} />
                  {o.label}
                </span>
              </Button>
            ))}
          </div>
        </div>
        <SettingRow label="Keep the Droid CLI up to date" description="Updates silently on launch.">
          <Switch
            label="Keep the Droid CLI up to date"
            checked={cliAuto}
            onChange={setCliAuto}
            disabled={saving}
          />
        </SettingRow>
        <SettingRow
          label="Check for DROIDEX updates"
          description="Notifies you about verified updates. You choose when to install."
        >
          <Switch
            label="Check for DROIDEX updates"
            checked={appAuto}
            onChange={setAppAuto}
            disabled={saving}
          />
        </SettingRow>
      </Panel>

      {saveError && <p className="mb-3 text-body text-danger">{saveError}</p>}

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={saving}
          onClick={() => {
            void save();
          }}
          disabled={saving}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
