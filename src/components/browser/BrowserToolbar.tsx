import { useMemo, useRef, type RefObject } from 'react';
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
  type IconComponent,
} from '@droidex/icons';
import { describeLink } from '../../lib/linkPresentation';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
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
    <header className="relative flex h-12 shrink-0 items-center gap-2 bg-bg px-2">
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          title="Back: return to the previous page (⌘[)"
          disabled={!canGoBack || loading}
          onClick={onGoBack}
          icon={ArrowLeft}
        />
        <IconButton
          title="Forward: go to the next page in history (⌘])"
          disabled={!canGoForward || loading}
          onClick={onGoForward}
          icon={ArrowRight}
        />
        <IconButton
          title={loading ? 'Loading page' : 'Reload: refresh the current page (⌘R)'}
          loading={loading}
          onClick={onReload}
          icon={RefreshCw}
        />
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
            icon={expanded ? Minimize : Maximize}
          />
        )}
        <div
          role="group"
          aria-label="Design tools"
          className={`flex items-center gap-0.5 rounded-full p-0.5 transition-colors duration-150 ease-out ${
            designMode ? 'bg-elevated' : 'bg-elevated/50'
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
            icon={MousePointer}
          />
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
            icon={PenLine}
          />
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
      className={`group mx-auto flex h-9 min-w-0 max-w-2xl flex-1 items-center gap-2.5 rounded-full bg-elevated/60 pl-3.5 pr-1 transition-colors duration-150 ease-out hover:bg-elevated focus-within:!bg-raised motion-reduce:transition-none`}
      onSubmit={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {searching ? (
        <Search className="h-4 w-4 shrink-0 text-muted" />
      ) : link ? (
        <LinkBadge key={link.host} link={link} className="h-4 w-4 shrink-0" />
      ) : (
        <Globe className="h-4 w-4 shrink-0 text-muted" />
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
          className="peer absolute inset-0 h-full w-full min-w-0 bg-transparent text-body text-transparent outline-none placeholder:text-muted focus:text-primary"
          placeholder="Search or enter address"
          aria-label="Browser address"
        />
        <AddressText value={value} />
      </span>
      {secure && (
        <span
          role="img"
          aria-label="Secure connection"
          className="flex h-7 w-5 shrink-0 items-center justify-center text-muted group-focus-within:hidden"
        >
          <Lock className="h-3.5 w-3.5" />
        </span>
      )}
      <Tooltip label="Open address (↵)" className="hidden shrink-0 group-focus-within:inline-flex">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          shape="round"
          icon={CornerDownLeft}
          aria-label="Open address"
          // Pressing it keeps the field focused, so the button stays to be clicked.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        />
      </Tooltip>
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
      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-body peer-focus:invisible"
    >
      <span className="truncate">
        <span className="font-medium text-primary">{host}</span>
        <span className="text-muted">{rest}</span>
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
          className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 origin-left bg-accent"
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

// A round ghost button under a tooltip; its title names it for the keyboard
// and screen readers.
function IconButton({
  title,
  active,
  disabled,
  loading = false,
  onClick,
  icon: Icon,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  icon: IconComponent;
}) {
  return (
    <Tooltip label={title}>
      <Button
        variant="ghost"
        shape="round"
        icon={Icon}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
      />
    </Tooltip>
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
  icon: Icon,
}: {
  title: string;
  pressed: boolean;
  current: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: IconComponent;
}) {
  return (
    <Tooltip label={title}>
      <Button
        variant={current ? 'primary' : 'ghost'}
        size="sm"
        shape="round"
        icon={Icon}
        aria-label={title}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={current ? 'shadow-sm' : undefined}
      />
    </Tooltip>
  );
}
