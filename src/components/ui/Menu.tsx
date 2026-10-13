import {
  createContext,
  useContext,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import { useMergeRefs } from '@floating-ui/react';
import type { IconComponent } from '@droidex/icons';
import { cn } from './cn';
import { navigationIndex, typeaheadIndex } from './menuKeys';
import { Popover, type PopoverProps } from './Popover';

// How long typed letters keep adding to one type-ahead query.
const TYPEAHEAD_RESET_MS = 500;
// The select blink: highlight off, then on, then close (feel.md).
const SELECT_BLINK_MS = 90;

// Items may pass role="menuitemcheckbox" or "menuitemradio" with aria-checked.
const ENABLED_ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

interface MenuContextValue {
  listRef: RefObject<HTMLDivElement | null>;
  selectingRef: RefObject<boolean>;
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(): MenuContextValue {
  const menu = useContext(MenuContext);
  if (!menu) throw new Error('Menu parts must be rendered inside <Menu>.');
  return menu;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type MenuProps = Omit<PopoverProps, 'role'>;

// A list of actions in a popover. Focus is the highlight: arrows, Home/End and
// type-ahead move it, the pointer moves it on hover, and choosing an item
// blinks it, closes the menu and then runs the item's action.
function MenuRoot({
  ref,
  width = 240,
  onClose,
  onKeyDown,
  className,
  children,
  ...rest
}: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergeRefs([listRef, ref]);
  const selectingRef = useRef(false);
  const typeahead = useRef({ query: '', resetAt: 0 });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // A menu is one Tab stop: Tab leaves it, like Escape.
    if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? []);
    const current = items.findIndex((item) => item === document.activeElement);
    let next = navigationIndex(event.key, current, items.length);
    if (next === null && isTypeaheadKey(event)) {
      const now = Date.now();
      const query =
        now < typeahead.current.resetAt ? typeahead.current.query + event.key : event.key;
      typeahead.current = { query, resetAt: now + TYPEAHEAD_RESET_MS };
      const labels = items.map((item) => item.textContent);
      const match = typeaheadIndex(labels, query, current);
      next = match < 0 ? null : match;
    }
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };

  return (
    <MenuContext.Provider value={{ listRef, selectingRef, close: onClose }}>
      <Popover
        {...rest}
        ref={mergedRef}
        role="menu"
        width={width}
        onClose={onClose}
        onKeyDown={handleKeyDown}
        // The menu takes focus itself, so nothing is highlighted until the
        // keyboard or pointer picks an item.
        autoFocus
        className={cn('overflow-y-auto p-1.5', className)}
      >
        {children}
      </Popover>
    </MenuContext.Provider>
  );
}

function isTypeaheadKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey
  );
}

const ITEM_TONE = {
  neutral: 'text-primary focus:bg-elevated dark:focus:bg-active',
  danger: 'text-danger focus:bg-danger-soft',
};

interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  ref?: Ref<HTMLButtonElement>;
  icon?: IconComponent;
  danger?: boolean;
  onSelect: () => void;
}

function MenuItem({
  ref,
  icon: Icon,
  danger = false,
  disabled = false,
  onSelect,
  onClick,
  onPointerMove,
  onPointerLeave,
  className,
  children,
  ...rest
}: MenuItemProps) {
  const { listRef, selectingRef, close } = useMenu();
  const itemRef = useRef<HTMLButtonElement>(null);
  const mergedRef = useMergeRefs([itemRef, ref]);

  const select = async () => {
    const item = itemRef.current;
    if (disabled || !item || selectingRef.current) return;
    selectingRef.current = true;
    listRef.current?.focus({ preventScroll: true });
    await wait(SELECT_BLINK_MS);
    item.focus({ preventScroll: true });
    await wait(SELECT_BLINK_MS);
    selectingRef.current = false;
    // The menu may have been closed from elsewhere during the blink.
    if (!item.isConnected) return;
    close();
    onSelect();
  };

  return (
    <button
      ref={mergedRef}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-danger={danger || undefined}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void select();
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const item = itemRef.current;
        if (disabled || selectingRef.current || item === document.activeElement) return;
        item?.focus({ preventScroll: true });
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (!selectingRef.current) listRef.current?.focus({ preventScroll: true });
      }}
      className={cn(
        'flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-body outline-none',
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
        ITEM_TONE[danger ? 'danger' : 'neutral'],
        className,
      )}
    >
      {Icon && (
        <Icon className={cn('size-icon-md shrink-0', !danger && 'text-muted')} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

// A trailing keyboard shortcut inside an item, in Mac glyphs (⌘ ⇧ ⌥ ⌃ ↩).
function MenuShortcut({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={cn(
        'ml-auto shrink-0 rounded-sm bg-bg/70 px-1.5 text-caption text-secondary',
        className,
      )}
    />
  );
}

function MenuLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      {...rest}
      className={cn('select-none px-2 pb-1 pt-1.5 text-label text-muted', className)}
    />
  );
}

function MenuDivider({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" {...rest} className={cn('mx-2 my-1 h-px bg-divider', className)} />;
}

export const Menu = Object.assign(MenuRoot, {
  Item: MenuItem,
  Shortcut: MenuShortcut,
  Label: MenuLabel,
  Divider: MenuDivider,
});
