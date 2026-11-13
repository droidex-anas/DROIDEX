import { useRef, useState } from 'react';
import { Check, ChevronDown } from '@droidex/icons';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { EDITOR_OPTIONS, editorLabel, type EditorId } from '../../lib/editorOpen';
import type { ProviderKind } from '../../types/bridge';
import { EditorIcon } from '../EditorIcon';
import { ModelIcon } from '../ModelIcon';
import { SettingRow } from '../settingsKit';
import { Switch } from '../Switch';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { canStartChats, joinNames, type AgentStatus, type AgentStatuses } from './agents';
import { Segmented } from './Segmented';
import { StepHeader } from './StepHeader';

export interface Defaults {
  editor: EditorId;
  /** The agent a new chat starts on. */
  draftAgent: ProviderKind;
  cliAutoUpdate: boolean;
  harnessCliAutoUpdate: boolean;
  appAutoUpdate: boolean;
}

const OPEN_FILES_IN = 'Open files in';

function EditorPicker({
  value,
  installed,
  onChange,
}: {
  value: EditorId;
  /** The editors found on this Mac; empty when the list couldn't be read. */
  installed: readonly EditorId[];
  onChange: (editor: EditorId) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${OPEN_FILES_IN}: ${editorLabel(value)}`}
        onClick={() => {
          setOpen((shown) => !shown);
        }}
      >
        <span className="flex items-center gap-1.5">
          <EditorIcon editor={value} size={14} />
          {editorLabel(value)}
          <ChevronDown className="size-3" aria-hidden="true" />
        </span>
      </Button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={buttonRef}
        label={OPEN_FILES_IN}
        placement="bottom-end"
        width={200}
      >
        {EDITOR_OPTIONS.map((option) => {
          const available = installed.length === 0 || installed.includes(option.id);
          return (
            <Menu.Item
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === value}
              disabled={!available}
              title={available ? undefined : 'Not installed on this Mac'}
              onSelect={() => {
                onChange(option.id);
              }}
            >
              <EditorIcon editor={option.id} size={16} />
              <span className="flex-1">{option.label}</span>
              {option.id === value && (
                <Check className="size-icon-sm text-accent" aria-hidden="true" />
              )}
            </Menu.Item>
          );
        })}
      </Menu>
    </>
  );
}

function unreadyReason(agent: ProviderKind, status: AgentStatus): string | undefined {
  if (canStartChats(status)) return undefined;
  const label = PROVIDER_LABELS[agent];
  switch (status.state) {
    case 'checking':
      return `Checking ${label}`;
    case 'missing':
      return `${label} isn't installed yet`;
    case 'unavailable':
      return status.reason;
    default:
      return `${label} needs a sign-in first`;
  }
}

export function DefaultsStep({
  values,
  chosen,
  statuses,
  installedEditors,
  onChange,
}: {
  values: Defaults;
  chosen: readonly ProviderKind[];
  statuses: AgentStatuses;
  installedEditors: readonly EditorId[];
  onChange: (patch: Partial<Defaults>) => void;
}) {
  const harnesses = chosen.filter((agent) => agent !== 'droid');
  const harnessUpdatesLabel = `Keep ${joinNames(harnesses)} up to date`;
  return (
    <div className="flex flex-col">
      <StepHeader
        title="Make it yours"
        sub="A few defaults to start with. Change any of them later in Settings."
      />
      <div
        className="droid-rise ob-well mt-7 flex flex-col py-1"
        style={{ animationDelay: '100ms' }}
      >
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <div>
            <div className="text-body text-primary">New chats start on</div>
            <div className="mt-0.5 text-caption text-muted">
              Pick another agent for any new chat from the composer.
            </div>
          </div>
          <Segmented
            label="New chats start on"
            value={values.draftAgent}
            options={chosen.map((agent) => ({
              value: agent,
              label: PROVIDER_LABELS[agent],
              icon: <ModelIcon provider={PROVIDER_MARKS[agent]} size={14} />,
              disabledReason: unreadyReason(agent, statuses[agent]),
            }))}
            onChange={(draftAgent) => {
              onChange({ draftAgent });
            }}
          />
        </div>
        <SettingRow label={OPEN_FILES_IN} description="Used when you open a file or a diff.">
          <EditorPicker
            value={values.editor}
            installed={installedEditors}
            onChange={(editor) => {
              onChange({ editor });
            }}
          />
        </SettingRow>
        {chosen.includes('droid') && (
          <SettingRow
            label="Keep the Droid CLI up to date"
            description="Updates quietly when DROIDEX starts."
          >
            <Switch
              label="Keep the Droid CLI up to date"
              checked={values.cliAutoUpdate}
              onChange={(cliAutoUpdate) => {
                onChange({ cliAutoUpdate });
              }}
            />
          </SettingRow>
        )}
        {harnesses.length > 0 && (
          <SettingRow
            label={harnessUpdatesLabel}
            description="Each one updates through the installer that put it on this Mac."
          >
            <Switch
              label={harnessUpdatesLabel}
              checked={values.harnessCliAutoUpdate}
              onChange={(harnessCliAutoUpdate) => {
                onChange({ harnessCliAutoUpdate });
              }}
            />
          </SettingRow>
        )}
        <SettingRow
          label="Check for DROIDEX updates"
          description="Shows a pill when an update is ready. You choose when to install."
        >
          <Switch
            label="Check for DROIDEX updates"
            checked={values.appAutoUpdate}
            onChange={(appAutoUpdate) => {
              onChange({ appAutoUpdate });
            }}
          />
        </SettingRow>
      </div>
    </div>
  );
}
