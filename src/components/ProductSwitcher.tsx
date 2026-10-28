import { useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { MessageBubble, Sketch } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { ProductMode } from '../hooks/persistedUiPreferences';
import { formatChord } from '../lib/shortcuts';
import { Tooltip } from './ui/Tooltip';

const PRODUCTS = [
  { mode: 'chat', label: 'Chat', icon: MessageBubble },
  { mode: 'design', label: 'Design', icon: Sketch },
] as const;

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * The Chat | Design segmented switch beside the window controls (spec §4).
 * The store owns what each product opens on: Design its home, Chat the chat it
 * was left on.
 */
export function ProductSwitcher() {
  const productMode = useStoreSelector((current) => current.productMode);
  const chord = useStoreSelector((current) => current.shortcutBindings.toggleProduct);
  const dispatch = useStoreDispatch();
  const segments = useRef<Partial<Record<ProductMode, HTMLButtonElement | null>>>({});

  const select = (mode: ProductMode) => {
    if (mode !== productMode) dispatch({ type: 'SET_PRODUCT_MODE', mode });
  };

  // A radio group moves its selection with the arrows; with two products,
  // every arrow lands on the other one.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.has(event.key)) return;
    event.preventDefault();
    const other: ProductMode = productMode === 'chat' ? 'design' : 'chat';
    select(other);
    segments.current[other]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Product"
      onKeyDown={walk}
      className="flex gap-0.5 rounded-lg bg-elevated p-0.5"
    >
      {PRODUCTS.map((product) => {
        const { mode, label } = product;
        const selected = mode === productMode;
        return (
          <Tooltip
            key={mode}
            label={selected ? label : `Switch to ${label} (${formatChord(chord)})`}
            placement="bottom"
          >
            <button
              ref={(node) => {
                segments.current[mode] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                select(mode);
              }}
              className={`relative flex size-control-sm cursor-pointer items-center justify-center rounded-md transition-colors ${
                selected ? 'text-primary' : 'text-muted hover:text-primary'
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="product-switcher-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-active"
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              <product.icon aria-hidden className="relative size-icon-md" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
