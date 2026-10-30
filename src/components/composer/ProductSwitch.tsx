import { useRef, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MessageBubble, Sketch } from '@droidex/icons';
import { useStoreSelector } from '../../hooks/useStore';
import type { ProductMode } from '../../features/tabs/tabStrip';
import { formatChord } from '../../lib/shortcuts';
import { Tooltip } from '../ui/Tooltip';

const PRODUCTS = [
  { mode: 'chat', label: 'Chat', Icon: MessageBubble },
  { mode: 'design', label: 'Design', Icon: Sketch },
] as const;

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

// A toggle can reverse mid-way, so its thumb keeps its speed (feel.md).
const THUMB_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

/**
 * Chat | Design under a new chat's composer: the product its first prompt
 * starts (spec §4). One track with a thumb that slides to the choice.
 */
export function ProductSwitch({
  product,
  onSwitch,
}: {
  product: ProductMode;
  onSwitch: (mode: ProductMode) => void;
}) {
  const chord = useStoreSelector((current) => current.shortcutBindings.toggleProduct);
  const reduceMotion = useReducedMotion();
  const radios = useRef<Partial<Record<ProductMode, HTMLButtonElement | null>>>({});
  const other: ProductMode = product === 'chat' ? 'design' : 'chat';

  // A radio group moves its selection with the arrows; with two products,
  // every arrow lands on the other one.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.has(event.key)) return;
    event.preventDefault();
    onSwitch(other);
    radios.current[other]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Product"
      onKeyDown={walk}
      className="relative inline-grid grid-cols-2 rounded-lg bg-elevated p-1"
    >
      <motion.span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-md bg-raised shadow-sm dark:bg-active"
        // Half the track, less its padding: the width of one choice.
        style={{ width: 'calc(50% - 4px)' }}
        initial={false}
        animate={{ x: product === 'design' ? '100%' : '0%' }}
        transition={reduceMotion ? { duration: 0 } : THUMB_SPRING}
      />
      {PRODUCTS.map(({ mode, label, Icon }) => {
        const selected = mode === product;
        const radio = (
          <button
            key={mode}
            ref={(node) => {
              radios.current[mode] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            // A click keeps the focus where it was, so typing carries on in
            // the prompt; the keyboard still reaches the group with Tab.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (!selected) onSwitch(mode);
            }}
            className={`relative flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-label transition-colors duration-150 ${
              selected ? 'text-primary' : 'text-muted hover:text-secondary'
            }`}
          >
            <Icon aria-hidden className="size-icon-sm shrink-0" />
            {label}
          </button>
        );
        return selected ? (
          radio
        ) : (
          <Tooltip key={mode} label={`Switch to ${label} (${formatChord(chord)})`}>
            {radio}
          </Tooltip>
        );
      })}
    </div>
  );
}
