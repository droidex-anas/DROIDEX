import { X } from 'lucide-react';
import type {
  BrowserSettingsPatch,
  BrowserSettingsSnapshot,
  BrowserSitePermission,
  BrowserSitePermissionMode,
} from '../../lib/browserSettings';
import { Dropdown, SettingRow } from '../settingsKit';
import {
  BrowserSettingsGroup,
  EmptyLine,
  ListHeading,
  SiteOrigin,
} from './BrowserSettingsPrimitives';

const MODE_OPTIONS: { value: BrowserSitePermissionMode; label: string }[] = [
  { value: 'ask', label: 'Ask me' },
  { value: 'block', label: 'Block' },
];

const PERMISSION_LABELS: Record<BrowserSitePermission, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  midi: 'MIDI devices',
  midiSysex: 'MIDI system exclusive',
};
const PERMISSIONS = Object.keys(PERMISSION_LABELS) as BrowserSitePermission[];

interface SiteGrant {
  origin: string;
  permissions: BrowserSitePermission[];
}

function grantsWith(snapshot: BrowserSettingsSnapshot, decision: 'allow' | 'deny'): SiteGrant[] {
  return snapshot.sitePermissionRules
    .map((rule) => ({
      origin: rule.origin,
      permissions: PERMISSIONS.filter((permission) => rule[permission] === decision),
    }))
    .filter((grant) => grant.permissions.length > 0);
}

/**
 * The site permission mode and each site's remembered choices. Removing one
 * makes the site ask again the next time it wants that permission.
 */
export function BrowserSiteGrants({
  snapshot,
  onPatch,
  onRevoke,
}: {
  snapshot: BrowserSettingsSnapshot;
  onPatch: (patch: BrowserSettingsPatch) => void;
  onRevoke: (origin: string, permission: BrowserSitePermission) => void;
}) {
  const allowed = grantsWith(snapshot, 'allow');
  const blocked = grantsWith(snapshot, 'deny');
  const blocking = snapshot.sitePermissionMode === 'block';
  return (
    <BrowserSettingsGroup title="Site permissions">
      <SettingRow
        label="Permission requests"
        description="Ask me shows a DROIDEX prompt and remembers each site's choice below. Block refuses without asking. USB, HID and serial devices stay blocked."
      >
        <Dropdown
          value={snapshot.sitePermissionMode}
          options={MODE_OPTIONS}
          ariaLabel="Site permissions"
          width="w-36"
          onChange={(value) => {
            const option = MODE_OPTIONS.find((candidate) => candidate.value === value);
            if (option) onPatch({ sitePermissionMode: option.value });
          }}
        />
      </SettingRow>
      {allowed.length === 0 && blocked.length === 0 ? (
        <EmptyLine>Sites you allow or block will appear here.</EmptyLine>
      ) : (
        <div className="pb-2">
          <GrantList
            label="Allowed"
            description={
              blocking
                ? 'Permissions are set to Block, so these choices stay inactive until you switch back to Ask me.'
                : 'These sites use what you allowed without another DROIDEX prompt.'
            }
            grants={allowed}
            onRevoke={onRevoke}
          />
          <GrantList
            label="Blocked"
            description="These sites cannot use what you blocked."
            grants={blocked}
            onRevoke={onRevoke}
          />
        </div>
      )}
    </BrowserSettingsGroup>
  );
}

function GrantList({
  label,
  description,
  grants,
  onRevoke,
}: {
  label: string;
  description: string;
  grants: SiteGrant[];
  onRevoke: (origin: string, permission: BrowserSitePermission) => void;
}) {
  if (grants.length === 0) return null;
  return (
    <>
      <ListHeading label={label} description={description} />
      <ul aria-label={`${label} site permissions`} className="px-2">
        {grants.map(({ origin, permissions }) => (
          <li
            key={origin}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-droid-elevated/50"
          >
            <SiteOrigin origin={origin} />
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {permissions.map((permission) => (
                <span
                  key={permission}
                  className="flex items-center gap-0.5 rounded-md bg-droid-elevated py-0.5 pl-2 pr-0.5 text-[11px] text-droid-text-secondary"
                >
                  {PERMISSION_LABELS[permission]}
                  <button
                    type="button"
                    onClick={() => {
                      onRevoke(origin, permission);
                    }}
                    aria-label={`Remove ${PERMISSION_LABELS[permission]} choice for ${origin}`}
                    title="Ask again"
                    className="rounded p-0.5 text-droid-text-muted transition-colors hover:bg-droid-active hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
