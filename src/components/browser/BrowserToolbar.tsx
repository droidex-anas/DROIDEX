import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  Globe,
  Lock,
  Maximize,
  Minimize,
  MousePointer,
  PenLine,
  RefreshCw,
  Search,
  Spinner,
} from '@droidex/icons';
import { describeLink } from '../../lib/linkPresentation';
import { HoverTooltip } from '../HoverTooltip';
import { LinkBadge } from '../transcript/LinkBadge';
import { browserAddressValue } from './browserUrlSafety';
import { normalizeUrl, SEARCH_URL } from './browserViewport';

interface BrowserToolbarProps {
  urlInputRef: RefObject<HTMLInputElement | null>;
  urlInput: string;
  /** The address of the page shown, which names its site and its lock. */
  pageUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  designMode: boolean;
  designModeDisabled?: boolean;
  pencilMode: boolean;
  expanded?: boolean;
  onUrlInputChange: (value: string) => void;
  onOpen: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onToggleDesignMode: () => void;
  onTogglePencilMode: () => void;
  onToggleExpanded?: () => void;
}

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]';
// Short, soft feedback on every control, and none of the movement when the
// reader asks for less.
const PRESS = `transition-[background-color,color,box-shadow,transform,opacity] duration-150 ${EASE} active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 disabled:pointer-events-none disabled:opacity-30`;

// Navigation quietly on the left, the address as the one wide thing in the
// middle, the pane's size and the design tools on the right.
export function BrowserToolbar({
  urlInputRef,
  urlInput,
  pageUrl,
  canGoBack,
  canGoForward,
  loading,
  designMode,
  designModeDisabled,
  pencilMode,
  expanded,
  onUrlInputChange,
  onOpen,
  onGoBack,
  onGoForward,
  onReload,
  onToggleDesignMode,
  onTogglePencilMode,
  onToggleExpanded,
}: BrowserToolbarProps) {
  const drawing = designMode && pencilMode;
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-droid-border bg-droid-bg px-2">
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          title="Back: return to the previous page (⌘[)"
          disabled={!canGoBack || loading}
          onClick={onGoBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <IconButton
          title="Forward: go to the next page in history (⌘])"
          disabled={!canGoForward || loading}
          onClick={onGoForward}
        >
          <ArrowRight className="h-4 w-4" />
        </IconButton>
        <IconButton
          title={loading ? 'Loading page' : 'Reload: refresh the current page (⌘R)'}
          onClick={onReload}
        >
          {loading ? (
            <Spinner className="h-4 w-4 motion-safe:animate-spin-slow" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </IconButton>
      </div>

      <AddressBar
        inputRef={urlInputRef}
        value={urlInput}
        pageUrl={pageUrl}
        onChange={onUrlInputChange}
        onOpen={onOpen}
      />

      <div className="flex shrink-0 items-center gap-2">
        {onToggleExpanded && (
          <IconButton
            title={
              expanded
                ? 'Collapse: return the browser to the utility pane'
                : 'Expand: use the full workspace for the browser'
            }
            active={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </IconButton>
        )}
        <div
          role="group"
          aria-label="Design tools"
          className={`flex items-center gap-0.5 rounded-full p-0.5 transition-colors duration-150 ${
            designMode ? 'bg-droid-elevated' : 'bg-droid-elevated/50'
          }`}
        >
          <ToolButton
            title={
              designModeDisabled
                ? 'Select a chat before using Design Mode'
                : 'Design Mode: select components or drag over text, then describe a UI change'
            }
            pressed={designMode}
            current={designMode && !drawing}
            disabled={designModeDisabled}
            onClick={onToggleDesignMode}
          >
            <MousePointer className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={
              designModeDisabled
                ? 'Select a chat before sketching'
                : 'Annotate: sketch a region or mark up the page for Droid (D)'
            }
            pressed={drawing}
            current={drawing}
            disabled={designModeDisabled}
            onClick={onTogglePencilMode}
          >
            <PenLine className="h-4 w-4" />
          </ToolButton>
        </div>
      </div>

      <LoadingBar loading={loading} />
    </header>
  );
}

// The omnibox: the site's icon, its address read as host and path, and a lock
// for https. Editing shows the full address, selected, and a go button; Esc
// puts back the page's address.
function AddressBar({
  inputRef,
  value,
  pageUrl,
  onChange,
  onOpen,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  pageUrl: string;
  onChange: (value: string) => void;
  onOpen: () => void;
}) {
  const link = useMemo(() => describeLink(pageUrl), [pageUrl]);
  const secure = link !== null && /^https:/i.test(pageUrl);
  // Typed text that will run a search shows the search icon, not the page's.
  const searching =
    value !== browserAddressValue(pageUrl) && normalizeUrl(value).startsWith(SEARCH_URL);
  // A click that focuses the field selects the address instead of placing the caret.
  const selectOnRelease = useRef(false);

  return (
    <form
      className={`group mx-auto flex h-9 min-w-0 max-w-[720px] flex-1 items-center gap-2.5 rounded-full bg-droid-elevated/60 pl-3.5 pr-1 transition-[background-color,box-shadow] duration-150 ${EASE} hover:bg-droid-elevated focus-within:!bg-droid-raised focus-within:shadow-[0_0_0_1px_var(--droid-border-hover),0_0_0_4px_color-mix(in_srgb,var(--droid-accent)_8%,transparent)] motion-reduce:transition-none`}
      onSubmit={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {searching ? (
        <Search className="h-4 w-4 shrink-0 text-droid-text-muted" />
      ) : link ? (
        <LinkBadge key={link.host} link={link} className="h-4 w-4 shrink-0" />
      ) : (
        <Globe className="h-4 w-4 shrink-0 text-droid-text-muted" />
      )}
      <span className="relative h-full min-w-0 flex-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onMouseDown={(event) => {
            selectOnRelease.current = document.activeElement !== event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (selectOnRelease.current) event.preventDefault();
            selectOnRelease.current = false;
          }}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            // An input method still composing keeps its own Escape.
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onChange(browserAddressValue(pageUrl));
            event.currentTarget.blur();
          }}
          spellCheck={false}
          className="peer absolute inset-0 h-full w-full min-w-0 bg-transparent text-[13px] text-transparent outline-none placeholder:text-droid-text-muted focus:text-droid-text"
          placeholder="Search or enter address"
          aria-label="Browser address"
        />
        <AddressText value={value} />
      </span>
      {secure && (
        <span
          role="img"
          aria-label="Secure connection"
          className="flex h-7 w-5 shrink-0 items-center justify-center text-droid-text-muted group-focus-within:hidden"
        >
          <Lock className="h-3.5 w-3.5" />
        </span>
      )}
      <HoverTooltip
        label="Open address (↵)"
        className="hidden shrink-0 group-focus-within:inline-flex"
      >
        <button
          type="submit"
          aria-label="Open address"
          // Pressing it keeps the field focused, so the button stays to be clicked.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-droid-elevated text-droid-text-secondary hover:bg-droid-active hover:text-droid-text ${PRESS}`}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
    </form>
  );
}

// An http(s) address reads as its site and the quieter rest, without the
// scheme; anything else, such as text not yet opened, reads as typed.
function AddressText({ value }: { value: string }) {
  const web = /^https?:\/\/([^/?#]*)(.*)$/i.exec(value);
  const host = web ? web[1] : value;
  const rest = web && web[2] !== '/' ? web[2] : '';
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-[13px] peer-focus:invisible"
    >
      <span className="truncate">
        <span className="font-medium text-droid-text">{host}</span>
        <span className="text-droid-text-muted">{rest}</span>
      </span>
    </span>
  );
}

// A slim bar along the toolbar's foot while a page loads: it eases most of
// the way, then fills and fades as the page arrives. Reduced motion shows it
// whole and only fades it.
function LoadingBar({ loading }: { loading: boolean }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          key="loading"
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 origin-left bg-droid-accent"
          initial={{ scaleX: still ? 1 : 0, opacity: still ? 0.6 : 1 }}
          animate={{
            scaleX: still ? 1 : 0.85,
            transition: { duration: still ? 0 : 6, ease: [0.1, 0.8, 0.2, 1] },
          }}
          exit={{
            scaleX: 1,
            opacity: 0,
            transition: { scaleX: { duration: 0.2 }, opacity: { duration: 0.25, delay: 0.15 } },
          }}
        />
      )}
    </AnimatePresence>
  );
}

function IconButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTooltip label={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${PRESS} ${
          active
            ? 'bg-droid-elevated text-droid-text'
            : 'text-droid-text-secondary hover:bg-droid-elevated/70 hover:text-droid-text'
        }`}
      >
        {children}
      </button>
    </HoverTooltip>
  );
}

// A tool in the design group. The tool in use is raised out of the group; the
// pointer stays lit while the pencil draws, since design mode is still on.
function ToolButton({
  title,
  pressed,
  current,
  disabled,
  onClick,
  children,
}: {
  title: string;
  pressed: boolean;
  current: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTooltip label={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${PRESS} ${
          current
            ? 'bg-droid-text text-droid-bg shadow-droid-sm'
            : 'text-droid-text-secondary hover:bg-droid-active hover:text-droid-text aria-pressed:text-droid-text'
        }`}
      >
        {children}
      </button>
    </HoverTooltip>
  );
}
