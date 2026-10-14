import { Check, ChevronDown, Search } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Popover } from '../../components/ui/Popover';
import {
  LARGE_LIST_THRESHOLD,
  VIRTUAL_ROW_HEIGHT,
  virtualOptionWindow,
} from './selectVirtualization';

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: string;
  detail?: string;
  keywords?: string;
}

export function SelectMenu<Value extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select',
  searchable = false,
  disabled = false,
  align = 'end',
  width = 300,
  ariaLabel,
}: {
  value: Value;
  options: readonly SelectOption<Value>[];
  onChange: (value: Value) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  align?: 'start' | 'end';
  width?: number;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialIndexRef = useRef(0);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.label}\n${option.detail ?? ''}\n${option.keywords ?? ''}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [options, query]);
  const virtualized = visible.length > LARGE_LIST_THRESHOLD;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setScrollTop(0);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
    initialIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    setScrollTop(0);
    setQuery('');
    setOpen(true);
  }, [disabled, options, value]);

  const toggleMenu = useCallback(() => {
    if (open) close();
    else openMenu();
  }, [close, open, openMenu]);

  useEffect(() => {
    if (!disabled || !open) return;
    close();
  }, [close, disabled, open]);

  // Run once for each closed -> open transition. Inline option arrays from the
  // editor are intentionally not dependencies: rebuilding an equivalent array
  // must not refocus/recenter a menu every time the running timer ticks.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const index = initialIndexRef.current;
    if (list) {
      if (visible.length > LARGE_LIST_THRESHOLD) {
        const centered = Math.max(
          0,
          index * VIRTUAL_ROW_HEIGHT - Math.floor((list.clientHeight - VIRTUAL_ROW_HEIGHT) / 2),
        );
        // Set both the DOM scroll position and the virtual window before paint.
        // The old requestAnimationFrame path briefly rendered the top of the
        // timezone catalog, then jumped to the selected zone a frame later.
        list.scrollTop = centered;
        setScrollTop(centered);
      } else {
        ensureIndexVisible(list, index);
      }
    }
    // `visible` and `options` are deliberately excluded; see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || visible.length === 0) return;
    const boundedIndex = Math.min(activeIndex, visible.length - 1);
    if (boundedIndex !== activeIndex) {
      setActiveIndex(boundedIndex);
      return;
    }
    const list = listRef.current;
    if (!list) return;
    if (virtualized) {
      const top = boundedIndex * VIRTUAL_ROW_HEIGHT;
      const bottom = top + VIRTUAL_ROW_HEIGHT;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
      setScrollTop(list.scrollTop);
      return;
    }
    ensureIndexVisible(list, boundedIndex);
  }, [activeIndex, open, visible.length, virtualized]);

  const choose = useCallback(
    (option: SelectOption<Value> | undefined) => {
      if (!option) return;
      // Close before the parent update replaces editor rows. Pointer selection
      // commits on pointerdown so focus cannot bounce through a stale portal.
      // The popover returns focus to this button as the panel unmounts.
      close();
      onChange(option.value);
    },
    [close, onChange],
  );

  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visible.length > 0) {
        setActiveIndex((index) => Math.min(visible.length - 1, index + 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length > 0) setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (visible.length > 0) setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      if (visible.length > 0) setActiveIndex(visible.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(visible[activeIndex]);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        onClick={toggleMenu}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`inline-flex min-w-0 max-w-64 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-right text-body outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open
            ? 'bg-elevated text-primary'
            : 'text-secondary hover:bg-elevated/70 hover:text-primary'
        }`}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={`size-icon-sm shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <Popover
        open={open}
        anchorRef={buttonRef}
        onClose={close}
        label={ariaLabel ?? placeholder}
        placement={align === 'end' ? 'bottom-end' : 'bottom-start'}
        width={width}
      >
        <div className="flex min-h-0 flex-col" onKeyDown={onListKeyDown}>
          {searchable && (
            <div className="m-2.5 flex h-9 items-center gap-2 rounded-md bg-field px-3 text-muted">
              <Search className="size-icon-sm shrink-0" />
              <input
                value={query}
                aria-label={`Search ${ariaLabel ?? placeholder} options`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                  setScrollTop(0);
                  if (listRef.current) listRef.current.scrollTop = 0;
                }}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-muted"
              />
            </div>
          )}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-activedescendant={
              visible[activeIndex] ? `${listboxId}-${String(activeIndex)}` : undefined
            }
            tabIndex={searchable ? -1 : 0}
            onScroll={(event) => {
              if (virtualized) setScrollTop(event.currentTarget.scrollTop);
            }}
            className="min-h-0 max-h-72 overflow-y-auto overscroll-contain p-1.5 outline-none"
          >
            {virtualized ? (
              <VirtualizedOptions
                options={visible}
                value={value}
                activeIndex={activeIndex}
                listboxId={listboxId}
                scrollTop={scrollTop}
                onActiveIndex={setActiveIndex}
                onChoose={choose}
              />
            ) : (
              visible.map((option, index) => (
                <OptionButton
                  key={option.value}
                  option={option}
                  index={index}
                  listboxId={listboxId}
                  selected={option.value === value}
                  active={index === activeIndex}
                  onActive={() => {
                    setActiveIndex((current) => (current === index ? current : index));
                  }}
                  onChoose={() => {
                    choose(option);
                  }}
                />
              ))
            )}
            {visible.length === 0 && (
              <div className="py-7 text-center text-caption text-muted">No matches</div>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}

function VirtualizedOptions<Value extends string>({
  options,
  value,
  activeIndex,
  listboxId,
  scrollTop,
  onActiveIndex,
  onChoose,
}: {
  options: readonly SelectOption<Value>[];
  value: Value;
  activeIndex: number;
  listboxId: string;
  scrollTop: number;
  onActiveIndex: (index: number) => void;
  onChoose: (option: SelectOption<Value>) => void;
}) {
  const optionWindow = virtualOptionWindow(options.length, scrollTop);
  return (
    <div className="relative" style={{ height: optionWindow.totalHeight }}>
      <div
        className="absolute inset-x-0 top-0"
        style={{ transform: `translateY(${String(optionWindow.offset)}px)` }}
      >
        {options.slice(optionWindow.start, optionWindow.end).map((option, localIndex) => {
          const index = optionWindow.start + localIndex;
          return (
            <OptionButton
              key={option.value}
              option={option}
              index={index}
              listboxId={listboxId}
              selected={option.value === value}
              active={index === activeIndex}
              fixedHeight
              onActive={() => {
                if (index !== activeIndex) onActiveIndex(index);
              }}
              onChoose={() => {
                onChoose(option);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function OptionButton({
  option,
  index,
  listboxId,
  selected,
  active,
  fixedHeight = false,
  onActive,
  onChoose,
}: {
  option: SelectOption;
  index: number;
  listboxId: string;
  selected: boolean;
  active: boolean;
  fixedHeight?: boolean;
  onActive: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      id={`${listboxId}-${String(index)}`}
      type="button"
      role="option"
      aria-selected={selected}
      // The listbox (or the search field above it) owns arrow navigation and
      // Enter through `aria-activedescendant`; a tab stop per option would let
      // Tab and the active row disagree about what Enter selects.
      tabIndex={-1}
      onMouseMove={onActive}
      onFocus={onActive}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onChoose();
      }}
      onClick={(event) => {
        // Keyboard-generated clicks have detail 0. Pointer selection already
        // committed during pointerdown and must not fire a second change.
        if (event.detail === 0) onChoose();
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors ${
        fixedHeight ? 'h-control-lg' : 'min-h-control-lg py-1.5'
      } ${active ? 'bg-surface' : 'hover:bg-surface/65'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-primary">{option.label}</span>
        {option.detail && option.detail !== option.label && (
          <span className="mt-0.5 block truncate text-caption text-muted">{option.detail}</span>
        )}
      </span>
      {selected && <Check className="size-icon-sm shrink-0 text-secondary" strokeWidth={2.2} />}
    </button>
  );
}

function ensureIndexVisible(list: HTMLDivElement, index: number): void {
  const option = list.querySelector<HTMLElement>(
    `[role="option"]:nth-of-type(${String(index + 1)})`,
  );
  if (!option) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}
