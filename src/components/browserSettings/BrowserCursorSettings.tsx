import { AnimatePresence, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import type {
  BrowserAgentCursorStyle,
  BrowserSettingsPatch,
  BrowserSettingsSnapshot,
} from '../../lib/browserSettings';
import { AgentCursorGlyph } from '../browser/AgentCursorGlyph';
import design from '../browser/browserAgentCursorDesign.json';
import { Dropdown, SettingRow } from '../settingsKit';
import { Switch } from '../Switch';
import { BrowserSettingsGroup } from './BrowserSettingsPrimitives';

const STYLE_OPTIONS: { value: BrowserAgentCursorStyle; label: string; icon: ReactNode }[] = [
  { value: 'droidex', label: 'DROIDEX', icon: <StyleIcon cursorStyle="droidex" /> },
  { value: 'dark', label: 'Dark', icon: <StyleIcon cursorStyle="dark" /> },
  { value: 'light', label: 'Light', icon: <StyleIcon cursorStyle="light" /> },
];

function StyleIcon({ cursorStyle }: { cursorStyle: BrowserAgentCursorStyle }) {
  return <AgentCursorGlyph cursorStyle={cursorStyle} className="h-4 w-4 shrink-0" />;
}

/** Whether the agent's cursor shows over the page, and how it looks. */
export function BrowserCursorSettings({
  snapshot,
  onPatch,
}: {
  snapshot: BrowserSettingsSnapshot;
  onPatch: (patch: BrowserSettingsPatch) => void;
}) {
  // The slider moves the preview as it is dragged and saves once on release,
  // or when it loses focus after the arrow keys.
  const [draggedSize, setDraggedSize] = useState<number | null>(null);
  const size = draggedSize ?? snapshot.agentCursorSize;
  const commitSize = () => {
    if (draggedSize !== null && draggedSize !== snapshot.agentCursorSize) {
      onPatch({ agentCursorSize: draggedSize });
    }
    setDraggedSize(null);
  };

  return (
    <BrowserSettingsGroup title="Agent cursor">
      <SettingRow
        label="Show agent cursor"
        description="Point to where the agent clicks, hovers and scrolls on the page. Tabs and the sidebar still mark a browser at work."
      >
        <Switch
          label="Show agent cursor"
          checked={snapshot.showAgentCursor}
          onChange={(showAgentCursor) => {
            onPatch({ showAgentCursor });
          }}
        />
      </SettingRow>
      <AnimatePresence initial={false}>
        {snapshot.showAgentCursor && (
          <motion.div
            // Clipped only while it folds, so the style menu can open past it.
            initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
            animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-4 px-4 py-3">
              <CursorPreview cursorStyle={snapshot.agentCursorStyle} size={size} />
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-droid-text-secondary">Style</span>
                  <Dropdown
                    value={snapshot.agentCursorStyle}
                    options={STYLE_OPTIONS}
                    ariaLabel="Agent cursor style"
                    width="w-36"
                    onChange={(value) => {
                      const option = STYLE_OPTIONS.find((candidate) => candidate.value === value);
                      if (option) onPatch({ agentCursorStyle: option.value });
                    }}
                  />
                </div>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-droid-text-secondary">Size</span>
                  <span className="flex w-36 items-center gap-2.5">
                    <input
                      type="range"
                      min={design.size.min}
                      max={design.size.max}
                      step={2}
                      value={size}
                      aria-label="Agent cursor size"
                      aria-valuetext={`${String(size)} pixels`}
                      onChange={(event) => {
                        setDraggedSize(Number(event.currentTarget.value));
                      }}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onLostPointerCapture={commitSize}
                      onBlur={commitSize}
                      className="h-1 min-w-0 flex-1 cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/25"
                      style={{ accentColor: 'var(--droid-accent)' }}
                    />
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-droid-text-muted">
                      {size} px
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </BrowserSettingsGroup>
  );
}

// The cursor as it will look over a page, at the chosen size.
function CursorPreview({
  cursorStyle,
  size,
}: {
  cursorStyle: BrowserAgentCursorStyle;
  size: number;
}) {
  return (
    <div
      aria-hidden
      className="flex h-[76px] w-[96px] shrink-0 items-center justify-center rounded-xl bg-droid-elevated"
    >
      <div
        className="transition-[width,height] duration-150 ease-out"
        style={{ width: size, height: size }}
      >
        <AgentCursorGlyph cursorStyle={cursorStyle} page className="block h-full w-full" />
      </div>
    </div>
  );
}
