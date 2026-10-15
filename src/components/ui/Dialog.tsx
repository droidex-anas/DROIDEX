import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { FOCUSABLE_SELECTOR, wrapTabFocus } from '../../lib/focusTrap';
import { cn } from './cn';
import { pushEscapeLayer } from './escapeStack';
import { FloatingLayerRoot } from './floatingLayerRoot';

type DialogSize = 'confirm' | 'form' | 'content';

const WIDTH: Record<DialogSize, string> = {
  confirm: 'max-w-dialog-confirm',
  form: 'max-w-dialog-form',
  content: 'max-w-dialog-content',
};

// feel.md: dialogs enter in 180ms smooth-out and leave in 120ms ease-in.
const ENTER = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
const EXIT = { duration: 0.12, ease: 'easeIn' } as const;

const TitleIdContext = createContext<string | undefined>(undefined);

// Motion owns the animation and drag handlers on the panel.
interface DialogProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
> {
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  size?: DialogSize;
  /** False while work is in flight: Escape and a backdrop press then do nothing. */
  dismissible?: boolean;
  /** Takes focus on open; otherwise the first enabled control does. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

// A centred modal over a `bg` 60% backdrop. Mounting it opens it: focus moves
// in, Tab stays inside, Escape closes through the shared stack, and focus goes
// back to the opener on unmount. Name it with a <DialogTitle>. Wrap it in
// AnimatePresence for the exit fade.
export function Dialog({
  onClose,
  role = 'dialog',
  size = 'confirm',
  dismissible = true,
  initialFocusRef,
  className,
  onKeyDown,
  children,
  ...rest
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [layerRoot, setLayerRoot] = useState<HTMLDivElement | null>(null);
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const initialFocus = useRef(initialFocusRef);

  // Pushed in the layout phase, so layers the content opens later sit above
  // it. A busy dialog still takes Escape so the layer behind it stays open.
  useLayoutEffect(
    () =>
      pushEscapeLayer(() => {
        if (dismissibleRef.current) closeRef.current();
      }),
    [],
  );

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
        (element) => element.tabIndex >= 0,
      );
      (initialFocus.current?.current ?? first ?? panel).focus({ preventScroll: true });
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // React bubbles keys from the popovers this dialog opens through the panel;
  // those portal outside it and trap their own Tab.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    const panel = panelRef.current;
    const fromPanel = event.target instanceof Node && panel?.contains(event.target);
    if (!event.defaultPrevented && fromPanel) wrapTabFocus(event, panel);
  };

  const layer = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: ENTER }}
      exit={{ opacity: 0, transition: EXIT }}
      // Portaled outside #root, so it applies the UI zoom itself.
      style={{ zoom: 'var(--ui-zoom)' }}
      className="fixed inset-0 z-dialog flex items-center justify-center bg-bg/60 p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: ENTER }}
        exit={{ opacity: 0, transition: EXIT }}
        {...rest}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex max-h-full w-full flex-col rounded-2xl bg-surface p-6 shadow-lg outline-none',
          WIDTH[size],
          className,
        )}
      >
        <TitleIdContext.Provider value={titleId}>
          <FloatingLayerRoot.Provider value={layerRoot}>{children}</FloatingLayerRoot.Provider>
        </TitleIdContext.Provider>
      </motion.div>
    </motion.div>
  );
  // A static render (renderToStaticMarkup) has no <body> to portal into.
  if (typeof document === 'undefined') return layer;
  // The popover root sits after the scrim, not inside it: floating layers
  // apply the UI zoom themselves and position in unzoomed window pixels.
  return createPortal(
    <>
      {layer}
      <div ref={setLayerRoot} className="relative z-dialog" />
    </>,
    document.body,
  );
}

export function DialogTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  const id = useContext(TitleIdContext);
  return (
    <h2 id={id} {...rest} className={cn('text-balance text-heading text-primary', className)} />
  );
}

// The part that scrolls when the window is short; the title and actions stay
// put. It hangs into the dialog's padding so focus rings at its edges show.
export function DialogBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn('-mx-6 -mb-1 mt-2 min-h-0 overflow-y-auto px-6 py-1', className)}
    />
  );
}

// Bottom-right actions, the primary one last (engineering.md).
export function DialogActions({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('mt-6 flex items-center justify-end gap-2', className)} />;
}
