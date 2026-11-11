// The panel at the board's left: Layers or Components under their tabs, one
// at a time. ⌥1 and ⌥2 go to their tab from anywhere in the panel, and close
// it from the tab they name.

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { X } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import {
  COMPONENTS_KEY_LABEL,
  LAYERS_KEY_LABEL,
  sidePanelKey,
  type SidePanelTab,
} from '../boardKeys';

const TABS: Record<SidePanelTab, { label: string; keyLabel: string }> = {
  layers: { label: 'Layers', keyLabel: LAYERS_KEY_LABEL },
  components: { label: 'Components', keyLabel: COMPONENTS_KEY_LABEL },
};
const TAB_ORDER: SidePanelTab[] = ['layers', 'components'];

export function SidePanel({
  tab,
  onTab,
  onClose,
  children,
}: {
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  onClose: () => void;
  /** The open tab's panel. */
  children: ReactNode;
}) {
  const id = useId();
  const tabId = (each: SidePanelTab) => `${id}-${each}`;
  const shown = TABS[tab];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const chosen = sidePanelKey(event);
    // A frame's name field types ⌥ digits; the components search, a combobox, does not.
    const typing =
      event.target instanceof HTMLInputElement && event.target.getAttribute('role') !== 'combobox';
    if (!chosen || typing) return;
    event.preventDefault();
    event.stopPropagation();
    // A held key auto-repeats and would toggle straight back.
    if (event.repeat) return;
    if (chosen === tab) {
      onClose();
      return;
    }
    onTab(chosen);
    // The keyboard stays in the panel when the tab it was in goes.
    document.getElementById(tabId(chosen))?.focus();
  };
  // The tablist is one tab stop; the arrows switch tabs, as WAI-ARIA tabs do.
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'layers' ? 'components' : 'layers';
    onTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <aside
      aria-label="Layers and components"
      className="flex h-full w-sidebar shrink-0 flex-col bg-surface"
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 py-2 pl-2.5 pr-2">
        <div
          role="tablist"
          aria-label="Side panel"
          className="flex items-center gap-0.5"
          onKeyDown={onTabsKeyDown}
        >
          {TAB_ORDER.map((each) => (
            <Tooltip
              key={each}
              label={`${TABS[each].label}  ${TABS[each].keyLabel}`}
              placement="bottom"
            >
              <Button
                id={tabId(each)}
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={tab === each}
                aria-controls={`${id}-panel`}
                tabIndex={tab === each ? 0 : -1}
                onClick={() => {
                  onTab(each);
                }}
              >
                {TABS[each].label}
              </Button>
            </Tooltip>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          aria-label={`Close ${shown.label.toLowerCase()}`}
          title={`Close (${shown.keyLabel})`}
          onClick={onClose}
        />
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </aside>
  );
}
