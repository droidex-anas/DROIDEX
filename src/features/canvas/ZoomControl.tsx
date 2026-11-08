// The zoom bar at the board's bottom left: out and in, the zoom as a field to
// type a percentage into, and the menu of zoom commands with their keys.

import { useRef, useState } from 'react';
import { ChevronUp, Minus, Plus } from '@droidex/icons';
import { Input } from '../../components/ui/Field';
import { Menu } from '../../components/ui/Menu';
import { Tool } from './BoardTool';
import { MAX_SCALE, MIN_SCALE } from './canvasGeometry';

/** What the zoom menu and its shortcuts can ask the board to do. */
export type ZoomCommand = 'in' | 'out' | 'fit' | 'selection' | 'actual';

const ZOOM_ACTIONS: { command: ZoomCommand; label: string; hint: string }[] = [
  { command: 'in', label: 'Zoom in', hint: '+' },
  { command: 'out', label: 'Zoom out', hint: '−' },
  { command: 'fit', label: 'Zoom to fit', hint: '⇧1' },
  { command: 'selection', label: 'Zoom to selection', hint: '⇧2' },
  { command: 'actual', label: 'Zoom to 100%', hint: '⇧0' },
];

export function ZoomControl({
  scale,
  hasFrames,
  hasSelection,
  onZoom,
  onZoomTo,
  focusBoard,
}: {
  scale: number;
  hasFrames: boolean;
  hasSelection: boolean;
  onZoom: (command: ZoomCommand) => void;
  onZoomTo: (scale: number) => void;
  focusBoard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const enabled: Record<ZoomCommand, boolean> = {
    in: scale < MAX_SCALE,
    out: scale > MIN_SCALE,
    fit: hasFrames,
    selection: hasSelection,
    actual: true,
  };
  return (
    <div role="group" aria-label="Zoom" className="canvas-zoom">
      <Tool
        label="Zoom out"
        tip="Zoom out  −"
        disabled={!enabled.out}
        onClick={() => {
          onZoom('out');
        }}
      >
        <Minus className="h-4 w-4" aria-hidden />
      </Tool>
      <div className="canvas-tool canvas-zoom-value">
        <ZoomField scale={scale} onZoomTo={onZoomTo} focusBoard={focusBoard} />
        <button
          ref={trigger}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Zoom options"
          className="canvas-zoom-menu"
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <Tool
        label="Zoom in"
        tip="Zoom in  +"
        disabled={!enabled.in}
        onClick={() => {
          onZoom('in');
        }}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </Tool>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={trigger}
        label="Zoom"
        placement="top-start"
        width={208}
      >
        {ZOOM_ACTIONS.map(({ command, label, hint }) => (
          <Menu.Item
            key={command}
            disabled={!enabled[command]}
            onSelect={() => {
              onZoom(command);
            }}
          >
            {label}
            <Menu.Shortcut>{hint}</Menu.Shortcut>
          </Menu.Item>
        ))}
      </Menu>
    </div>
  );
}

/**
 * The zoom as a percentage, typed over: Enter goes there and Escape leaves it
 * as it was, and either hands the keyboard back to the board.
 */
function ZoomField({
  scale,
  onZoomTo,
  focusBoard,
}: {
  scale: number;
  onZoomTo: (scale: number) => void;
  focusBoard: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = `${String(Math.round(scale * 100))}%`;
  return (
    <Input
      variant="embedded"
      aria-label="Zoom percentage"
      inputMode="numeric"
      spellCheck={false}
      value={draft ?? shown}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        const percent = draft === null ? NaN : Number.parseFloat(draft);
        if (event.key === 'Enter' && percent > 0) onZoomTo(percent / 100);
        setDraft(null);
        focusBoard();
      }}
    />
  );
}
