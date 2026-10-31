// Spec §4: the docked chat column's tabs while its chat has a canvas on the
// board. Agent is the transcript under them; Components lays the canvas's
// frame list over it, above the composer.

import { useState, type KeyboardEvent } from 'react';
import './canvasColumn.css';
import { CanvasNavigator } from './CanvasNavigator';

type ColumnTab = 'agent' | 'components';

const TABS: { id: ColumnTab; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'components', label: 'Components' },
];

export function CanvasColumnTabs({ canvasId }: { canvasId: string }) {
  const [tab, setTab] = useState<ColumnTab>('agent');

  // The tablist is one tab stop; the arrows switch tabs, as WAI-ARIA tabs do.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'agent' ? 'components' : 'agent';
    setTab(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-column-tab="${next}"]`)?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Chat column"
        className="canvas-column-tabs"
        onKeyDown={onKeyDown}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-column-tab={id}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className="canvas-column-tab"
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'components' && (
        <div role="tabpanel" aria-label="Components" className="canvas-column-panel">
          <CanvasNavigator canvasId={canvasId} />
        </div>
      )}
    </>
  );
}
