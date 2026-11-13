// The selected frame's size, typed or picked from the screens, pages, posts and
// marks designs are usually built for. Either one is a single layout write,
// which the board makes.

import { Fragment, useState, type KeyboardEvent, type RefObject } from 'react';
import { RotateCcw } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Popover } from '../../components/ui/Popover';
import { MAX_FRAME_PX, MIN_FRAME_PX } from './canvasGeometry';
import { FRAME_PRESETS, PRESET_GROUPS } from './framePresets';
import { MenuHeading, MenuNote, MenuRow } from './menuRows';
import type { FrameRect } from './protocol';

export interface FrameSize {
  width: number;
  height: number;
}

export function FrameSizeMenu({
  open,
  onClose,
  anchorRef,
  rect,
  onResize,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  rect: FrameRect;
  onResize: (size: FrameSize) => void;
}) {
  const resize = (size: FrameSize) => {
    onClose();
    onResize(size);
  };
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      label="Frame size"
      placement="bottom"
      width={240}
    >
      <SizeFields rect={rect} onResize={resize} />
      <div role="menu" aria-label="Frame sizes" className="min-h-0 overflow-y-auto p-1.5 pt-0">
        {PRESET_GROUPS.map((group) => (
          <Fragment key={group}>
            <MenuHeading>{group}</MenuHeading>
            {FRAME_PRESETS.filter((preset) => preset.group === group).map(
              ({ name, width, height }) => (
                <MenuRow
                  key={name}
                  label={name}
                  hint={`${String(width)} × ${String(height)}`}
                  checked={rect.width === width && rect.height === height}
                  onRun={() => {
                    resize({ width, height });
                  }}
                />
              ),
            )}
          </Fragment>
        ))}
      </div>
    </Popover>
  );
}

/** Width and height as typed; Enter in either sets both. */
function SizeFields({ rect, onResize }: { rect: FrameRect; onResize: (size: FrameSize) => void }) {
  const [width, setWidth] = useState(String(Math.round(rect.width)));
  const [height, setHeight] = useState(String(Math.round(rect.height)));
  const [refused, setRefused] = useState(false);
  const submit = () => {
    const size = { width: dimension(width), height: dimension(height) };
    if (size.width === null || size.height === null) {
      setRefused(true);
      return;
    }
    onResize({ width: size.width, height: size.height });
  };
  const field = (label: 'Width' | 'Height', value: string, onChange: (next: string) => void) => (
    <Input
      variant="compact"
      aria-label={label}
      inputMode="numeric"
      value={value}
      invalid={refused && dimension(value) === null}
      leading={<span className="pr-1.5">{label[0]}</span>}
      className="tabular-nums"
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      }}
    />
  );
  return (
    <div className="flex flex-col gap-1.5 p-1.5">
      <div className="flex items-center gap-1.5">
        {field('Width', width, setWidth)}
        {field('Height', height, setHeight)}
        <Button
          variant="ghost"
          icon={RotateCcw}
          aria-label="Swap width and height"
          title="Swap width and height"
          onClick={() => {
            onResize({ width: Math.round(rect.height), height: Math.round(rect.width) });
          }}
        />
      </div>
      {refused && (dimension(width) === null || dimension(height) === null) && (
        <MenuNote role="alert">{`Width and height run from ${String(MIN_FRAME_PX)} to ${String(MAX_FRAME_PX)}.`}</MenuNote>
      )}
    </div>
  );
}

/** A typed size in whole pixels, or null when it is not one a frame can take. */
function dimension(typed: string): number | null {
  const value = Math.round(Number(typed));
  return typed.trim() !== '' && value >= MIN_FRAME_PX && value <= MAX_FRAME_PX ? value : null;
}
