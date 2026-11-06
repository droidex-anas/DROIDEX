// The frame toolbar's variant controls (spec §4). One click on Variants makes
// three variants and asks the chat's agent for them at once; the chevron beside
// it chooses what changes, how many, and a direction in the user's own words.
// On a variant, Use this variant gives its design to the frame it was made from.

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import type { ToolButtonProps, ToolId } from './FrameToolbar';
import type { CanvasFrame } from './protocol';
import { SegmentedControl, type Segment } from './SegmentedControl';
import {
  DEFAULT_VARIANT_CHOICE,
  type VariantChoice,
  type VariantCount,
  type VariantKind,
} from './variantRequests';

const KINDS: Segment<VariantKind>[] = [
  { value: 'any', label: 'Any' },
  { value: 'layout', label: 'Layout' },
  { value: 'style', label: 'Style' },
  { value: 'colour', label: 'Colour' },
  { value: 'explore', label: 'Explore' },
];
const COUNTS: Segment<VariantCount>[] = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];
const MAX_DIRECTION_LENGTH = 500;
/** Wide enough for five kinds side by side, "Explore" untruncated. */
const OPTIONS_WIDTH_PX = 392;

export function VariantsTool({
  frame,
  tool,
  onMake,
}: {
  frame: CanvasFrame;
  /** The bar's roving focus for each of the two buttons. */
  tool: (id: ToolId) => ToolButtonProps;
  onMake: (frame: CanvasFrame, choice: VariantChoice) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // A second click while the frames are being made would make another set.
  const make = async (choice: VariantChoice) => {
    if (making) return;
    setOpen(false);
    setMaking(true);
    try {
      await onMake(frame, choice);
    } finally {
      setMaking(false);
    }
  };

  return (
    <>
      <Tooltip label={`Make ${String(DEFAULT_VARIANT_CHOICE.count)} variants`}>
        <button
          type="button"
          {...tool('variants')}
          className="canvas-frame-tool canvas-frame-tool-text"
          aria-label={`Make ${String(DEFAULT_VARIANT_CHOICE.count)} variants of ${frame.name}`}
          aria-busy={making || undefined}
          onClick={() => {
            void make(DEFAULT_VARIANT_CHOICE);
          }}
        >
          Variants
        </button>
      </Tooltip>
      <Tooltip label="Variant options">
        <button
          ref={anchor}
          type="button"
          {...tool('variant-options')}
          className="canvas-frame-tool canvas-frame-tool-chevron"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Variant options for ${frame.name}`}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </Tooltip>
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchor}
        placement="bottom-start"
        width={OPTIONS_WIDTH_PX}
        label={`Variants of ${frame.name}`}
      >
        <VariantOptions
          onMake={(choice) => {
            void make(choice);
          }}
        />
      </Popover>
    </>
  );
}

export function UseVariantTool({
  variant,
  source,
  tool,
  onUse,
}: {
  variant: CanvasFrame;
  /** The frame the variant was made from, which takes its design. */
  source: CanvasFrame;
  tool: (id: ToolId) => ToolButtonProps;
  onUse: (variant: CanvasFrame, source: CanvasFrame) => Promise<boolean>;
}) {
  const [applying, setApplying] = useState(false);
  return (
    <Tooltip label={`Replace ${source.name} with this design`}>
      <button
        type="button"
        {...tool('use-variant')}
        className="canvas-frame-tool canvas-frame-tool-text"
        aria-label={`Use this variant for ${source.name}`}
        aria-busy={applying || undefined}
        onClick={() => {
          if (applying) return;
          setApplying(true);
          void onUse(variant, source).finally(() => {
            setApplying(false);
          });
        }}
      >
        Use this variant
      </button>
    </Tooltip>
  );
}

function VariantOptions({ onMake }: { onMake: (choice: VariantChoice) => void }) {
  const [kind, setKind] = useState(DEFAULT_VARIANT_CHOICE.kind);
  const [count, setCount] = useState(DEFAULT_VARIANT_CHOICE.count);
  const [direction, setDirection] = useState('');
  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onMake({ kind, count, direction });
      }}
    >
      <SegmentedControl
        label="Change"
        options={KINDS}
        value={kind}
        disabled={false}
        onPick={setKind}
      />
      <SegmentedControl
        label="How many"
        options={COUNTS}
        value={count}
        disabled={false}
        onPick={setCount}
      />
      <Field label="Direction (optional)">
        <Input
          variant="compact"
          value={direction}
          maxLength={MAX_DIRECTION_LENGTH}
          placeholder="More whitespace, a bolder headline…"
          onChange={(event) => {
            setDirection(event.target.value);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" size="sm" className="self-end">
        Make {String(count)} variants
      </Button>
    </form>
  );
}
