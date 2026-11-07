// The frame toolbar's variant controls (spec §4). One click on Variants makes
// three variants and asks the chat's agent for them at once; the chevron beside
// it chooses what changes, how many, and a direction in the user's own words.
// On a variant, Use this variant gives its design to the frame it was made from.
// Each holds, the busy one showing a spinner, while its source's set is busy.

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Spinner } from '@droidex/icons';
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
import type { VariantWork, VariantWorkView } from './variantSets';

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
/** Why a source's variant buttons hold while its set is busy. */
const BUSY_TIP: Record<VariantWork, string> = {
  making: 'Making variants…',
  using: 'Using a variant…',
};

export function VariantsTool({
  frame,
  tool,
  work,
  onMake,
}: {
  frame: CanvasFrame;
  /** The bar's roving focus for each of the two buttons. */
  tool: (id: ToolId) => ToolButtonProps;
  work: VariantWorkView;
  onMake: (frame: CanvasFrame, choice: VariantChoice) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const busy = useSyncExternalStore(work.subscribe, () => work.of(frame.designId));
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const make = (choice: VariantChoice) => {
    setOpen(false);
    void onMake(frame, choice);
  };

  return (
    <>
      <Tooltip
        label={busy ? BUSY_TIP[busy] : `Make ${String(DEFAULT_VARIANT_CHOICE.count)} variants`}
      >
        <button
          type="button"
          {...tool('variants')}
          className="canvas-frame-tool canvas-frame-tool-text relative"
          aria-label={`Make ${String(DEFAULT_VARIANT_CHOICE.count)} variants of ${frame.name}`}
          aria-disabled={busy !== null || undefined}
          aria-busy={busy === 'making' || undefined}
          onClick={() => {
            if (!busy) make(DEFAULT_VARIANT_CHOICE);
          }}
        >
          <BusyLabel busy={busy === 'making'}>Variants</BusyLabel>
        </button>
      </Tooltip>
      <Tooltip label={busy ? BUSY_TIP[busy] : 'Variant options'}>
        <button
          ref={anchor}
          type="button"
          {...tool('variant-options')}
          className="canvas-frame-tool canvas-frame-tool-chevron"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Variant options for ${frame.name}`}
          aria-disabled={busy !== null || undefined}
          onClick={() => {
            if (!busy) setOpen(!open);
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
        <VariantOptions onMake={make} />
      </Popover>
    </>
  );
}

export function UseVariantTool({
  variant,
  source,
  tool,
  work,
  onUse,
}: {
  variant: CanvasFrame;
  /** The frame the variant was made from, which takes its design. */
  source: CanvasFrame;
  tool: (id: ToolId) => ToolButtonProps;
  work: VariantWorkView;
  onUse: (variant: CanvasFrame, source: CanvasFrame) => Promise<boolean>;
}) {
  const busy = useSyncExternalStore(work.subscribe, () => work.of(source.designId));
  return (
    <Tooltip label={busy ? BUSY_TIP[busy] : `Replace ${source.name} with this design`}>
      <button
        type="button"
        {...tool('use-variant')}
        className="canvas-frame-tool canvas-frame-tool-text relative"
        aria-label={`Use this variant for ${source.name}`}
        aria-disabled={busy !== null || undefined}
        aria-busy={busy === 'using' || undefined}
        onClick={() => {
          if (!busy) void onUse(variant, source);
        }}
      >
        <BusyLabel busy={busy === 'using'}>Use this variant</BusyLabel>
      </button>
    </Tooltip>
  );
}

/** A tool's label, or a spinner in its place that keeps the tool's width. */
function BusyLabel({ busy, children }: { busy: boolean; children: string }) {
  if (!busy) return children;
  return (
    <>
      <span className="invisible">{children}</span>
      <span className="absolute inset-0 grid place-items-center">
        <Spinner className="size-3.5 animate-spin" aria-hidden />
      </span>
    </>
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
