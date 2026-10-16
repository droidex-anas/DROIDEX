import { Fragment, useRef, useState, type ReactNode } from 'react';
import { PanelRight, Plus, X } from '@droidex/icons';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import type { UtilityPanelState, UtilityTab, UtilityTool } from '../../lib/utilityPanel';
import { useStoreSelector } from '../../hooks/useStore';
import { WINDOW_CONTROLS_LEAD_PX } from '../../lib/windowChrome';
import { viewRowHoldsWindowControls } from '../../features/tabs/tabStrip';
import { PaneResizeHandle } from './PaneResizeHandle';
import { UtilityToolGrid, UtilityToolMenu } from './UtilityToolPicker';
import { UTILITY_TOOL_OPTIONS, utilityToolOption } from './utilityToolOptions';

export function UtilityPane({
  panel,
  width,
  minWidth,
  maxWidth,
  onResize,
  onResizeEnd,
  onOpenTool,
  onActivateTab,
  onCloseTab,
  onClosePane,
  renderTab,
  expanded = false,
}: {
  panel: UtilityPanelState;
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onOpenTool: (tool: UtilityTool) => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tab: UtilityTab) => void;
  onClosePane: () => void;
  renderTab: (tab: UtilityTab) => ReactNode;
  expanded?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  // Expanded, the pane owns the view's top row, where the traffic lights and
  // the sidebar toggle may sit too.
  const holdsWindowControls = useStoreSelector(viewRowHoldsWindowControls);
  const leadPx = expanded && holdsWindowControls ? WINDOW_CONTROLS_LEAD_PX : undefined;
  const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId) ?? null;
  const openSingletons = new Set(panel.tabs.map((tab) => tab.tool));
  const availableTools = UTILITY_TOOL_OPTIONS.map((option) => option.tool).filter(
    (tool) => tool === 'terminal' || !openSingletons.has(tool),
  );

  return (
    <aside
      aria-label="Utility pane"
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-sidebar"
      style={{
        backdropFilter: 'var(--sidebar-blur)',
        WebkitBackdropFilter: 'var(--sidebar-blur)',
      }}
    >
      {!expanded && (
        <PaneResizeHandle
          width={width}
          min={minWidth}
          max={maxWidth}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      )}

      <header
        data-electron-drag-region
        className="flex h-9 shrink-0 items-center gap-1 pl-2 pr-1.5"
        style={leadPx === undefined ? undefined : { paddingLeft: leadPx }}
      >
        <div
          role="tablist"
          aria-label="Open utility tools"
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {panel.tabs.map((tab) => {
            const Icon = utilityToolOption(tab.tool).icon;
            const active = tab.id === panel.activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex h-control-sm max-w-44 shrink-0 select-none items-center gap-1.5 rounded-md px-2 text-label transition-colors ${
                  active
                    ? 'bg-active text-primary'
                    : 'text-muted hover:bg-elevated hover:text-primary'
                }`}
              >
                <button
                  role="tab"
                  aria-selected={active}
                  title={tab.label}
                  onClick={() => {
                    onActivateTab(tab.id);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm"
                >
                  <Icon className="size-icon-sm shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
                <Tooltip label={`Close ${tab.label}`} placement="bottom">
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    className="ml-0.5 rounded-sm p-1 text-muted opacity-50 transition hover:bg-active hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(tab);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>

        <Tooltip label="Open another tool" placement="bottom">
          <Button
            ref={addRef}
            variant="ghost"
            size="sm"
            icon={Plus}
            aria-label="Open another tool"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          />
        </Tooltip>
        <Tooltip label="Hide utility pane" placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={PanelRight}
            aria-label="Hide utility pane"
            onClick={onClosePane}
          />
        </Tooltip>
      </header>

      <UtilityToolMenu
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
        anchorRef={addRef}
        tools={availableTools}
        onSelect={onOpenTool}
      />

      <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          <Fragment key={activeTab.id}>{renderTab(activeTab)}</Fragment>
        ) : (
          <div className="flex h-full items-center justify-center px-3 pb-16">
            <div className="w-full max-w-xs">
              <UtilityToolGrid
                tools={UTILITY_TOOL_OPTIONS.map((option) => option.tool)}
                onSelect={onOpenTool}
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
