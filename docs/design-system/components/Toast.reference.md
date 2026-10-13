# Toast: reference implementation

A working reference for the [Toast](Toast.md) design, for whoever implements it in the app. It covers what `src/components/ui/Toaster.tsx` does not yet: the warning, update and loading variants, in-place changes, progress and swipe to dismiss. It replaces `src/lib/toast.ts` and `src/components/ui/Toaster.tsx`, and adds one test. The code is kept here as Markdown so it doesn't compile, lint or run until someone moves it into `src/`.

## What it does

- **Look:** a raised, borderless card (`bg-raised`, `rounded-lg`, `shadow-lg`). Colour lives only in a 16px filled status icon. There are no dots, side bars, tinted fills or countdown bar.
- **Variants:** `success`, `error`, `info`, `warning`, `update` and `loading`. Info has no icon.
- **Timing:**
  - Success and info: 4s, or 6s when the toast has an action.
  - Warning: 6s.
  - Error, update and loading: stay until dismissed.
- **Pausing:** hovering or focusing the stack, or leaving the window, pauses every countdown, and each resumes where it stopped.
- **Content:** one optional action (Undo, Retry, Restart, View), an optional one-line description, and an optional progress line for downloads.
- **Repeats:** raising the same message again counts up (×2) instead of stacking.
- **In-place changes:** `toast.promise()` and `toast.change()` update a toast where it is, and the icon cross-fades.
- **Stacking:** up to 3 toasts peek behind the newest; hovering fans the stack out. At most 5 exist at once.
- **Dismissing:** swipe right, Escape on a focused toast, or the X. The X shows on hover for timed toasts and always for persistent ones. ⌥T focuses the newest toast.

## Moving it into the app

1. Replace `src/lib/toast.ts` and `src/components/ui/Toaster.tsx` with the code below (the Toaster then imports `../../lib/toast`), and add `src/lib/toast.behaviour.test.ts`.
2. The API stays compatible: every existing `toast.success/error/info(message)` and `pushToast(message, variant, ttl)` call keeps working.
3. **Behaviour change to check:** on `main`, errors disappear after the default timeout. Here they stay until dismissed. Review the 82 `toast.error(...)` calls. Errors that are really transient notices should become `toast.warning` or `toast.info`, or pass `{ ttl: 6000 }`.
4. Run `npm run typecheck`, `npm run lint` and `npm test`, then check both themes in the running app.

## Known follow-ups

- **Arbitrary Tailwind values:** the component uses `text-[13px]`, `z-[1300]` and a few others, which the design-token lint rejects. Swap them for the type styles and size tokens in `tailwind.config.js`, and `z-[1300]` for `z-toast`.
- **Height cache:** `heights` in `Toaster.tsx` keeps entries for dismissed toasts. It's harmless at five toasts, but prune it when a toast leaves if you touch that code.
- **Two status icons:** `CircleAlertFilled` and `CircleArrowUpFilled` are defined inline. Move them into `packages/icons` when they're adopted.
- **Target compatibility:** `Array.prototype.at` was replaced with an index here, because `tsconfig.json` targets ES2020.

## `src/lib/toast.ts`

```ts
// Toast store. Framework-free so anything (stores, IPC handlers, tests) can
// raise a toast. The <Toaster /> component subscribes and renders.
//
// Timing rules (design system: Toast):
//   success / info      4s, or 6s when the toast carries an action
//   warning             6s
//   error, update,      stay until dismissed or replaced
//   loading
// Hovering the stack or leaving the window pauses every countdown.

export type ToastVariant = 'success' | 'error' | 'info' | 'warning' | 'update' | 'loading';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  ttl: number;
  /** One short line under the title: what happened or what to do next. */
  description?: string;
  /** One text action, e.g. Undo, Retry, Restart, View. */
  action?: ToastAction;
  /** 0–1 for determinate work (an update downloading). */
  progress?: number;
  /** How many times the same toast was raised while showing (shown as ×N when > 1). */
  count?: number;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  ttl?: number;
  progress?: number;
}

type Listener = (toasts: ToastItem[]) => void;

const BASE_TTL: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 0,
  update: 0,
  loading: 0,
};
const ACTION_TTL_MS = 6000;
/** Older toasts beyond this are dismissed so the stack never grows a tower. */
const MAX_TOASTS = 5;

let toasts: ToastItem[] = [];
let nextId = 1;
let pausedAll = false;
const listeners = new Set<Listener>();

// Live auto-dismiss timers plus each toast's remaining time when paused,
// so a countdown resumes where it left off.
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const remaining = new Map<number, number>();
const startedAt = new Map<number, number>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

function defaultTtl(variant: ToastVariant, action?: ToastAction): number {
  const base = BASE_TTL[variant];
  return action && base > 0 ? Math.max(base, ACTION_TTL_MS) : base;
}

function clearTimer(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  remaining.delete(id);
  startedAt.delete(id);
}

function scheduleDismiss(id: number, ms: number): void {
  if (typeof setTimeout === 'undefined') return;
  clearTimeout(timers.get(id));
  remaining.set(id, ms);
  if (pausedAll) return; // resumes with resumeAllToasts()
  startedAt.set(id, Date.now());
  timers.set(
    id,
    setTimeout(() => {
      dismissToast(id);
    }, ms),
  );
}

export function dismissToast(id: number): void {
  clearTimer(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function dismissAllToasts(): void {
  for (const t of toasts) clearTimer(t.id);
  toasts = [];
  emit();
}

export function pauseToast(id: number): void {
  if (!timers.has(id)) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  const left = (remaining.get(id) ?? 0) - (Date.now() - (startedAt.get(id) ?? Date.now()));
  remaining.set(id, Math.max(0, left));
}

export function resumeToast(id: number): void {
  if (timers.has(id) || !remaining.has(id)) return;
  const left = remaining.get(id) ?? 0;
  if (left <= 0) {
    dismissToast(id);
    return;
  }
  scheduleDismiss(id, left);
}

/** Pause every countdown: the pointer is over the stack, or the window lost focus. */
export function pauseAllToasts(): void {
  pausedAll = true;
  for (const t of toasts) pauseToast(t.id);
}

export function resumeAllToasts(): void {
  pausedAll = false;
  for (const t of toasts) resumeToast(t.id);
}

function build(base: Omit<ToastItem, 'count'>, opts: ToastOptions, count = 1): ToastItem {
  // Optional keys are only present when set, so snapshots stay minimal.
  const item: ToastItem = {
    id: base.id,
    message: base.message,
    variant: base.variant,
    ttl: base.ttl,
  };
  if (opts.description) item.description = opts.description;
  if (opts.action) item.action = opts.action;
  if (opts.progress !== undefined) item.progress = Math.min(1, Math.max(0, opts.progress));
  if (count > 1) item.count = count;
  return item;
}

export function pushToast(
  message: string,
  variant: ToastVariant = 'info',
  ttlOrOptions?: number | ToastOptions,
): number {
  const opts: ToastOptions =
    typeof ttlOrOptions === 'number' ? { ttl: ttlOrOptions } : (ttlOrOptions ?? {});
  const ttl = opts.ttl ?? defaultTtl(variant, opts.action);

  // The same notice raised again while it is still showing stays one toast:
  // it counts up and its timer restarts, instead of stacking duplicates.
  const shown = toasts.find((t) => t.message === message && t.variant === variant);
  if (shown) {
    const updated = build({ id: shown.id, message, variant, ttl }, opts, (shown.count ?? 1) + 1);
    toasts = toasts.map((t) => (t.id === shown.id ? updated : t));
    emit();
    if (ttl > 0) scheduleDismiss(shown.id, ttl);
    return shown.id;
  }

  const id = nextId++;
  toasts = [...toasts, build({ id, message, variant, ttl }, opts)];
  while (toasts.length > MAX_TOASTS) {
    clearTimer(toasts[0].id);
    toasts = toasts.slice(1);
  }
  emit();
  if (ttl > 0) scheduleDismiss(id, ttl);
  return id;
}

/**
 * Change a toast in place (loading → success, progress ticks). The toast keeps
 * its slot and identity, so it morphs instead of popping out and back in.
 */
export function updateToast(
  id: number,
  patch: { message?: string; variant?: ToastVariant } & ToastOptions,
): void {
  const current = toasts.find((t) => t.id === id);
  if (!current) return;
  const variant = patch.variant ?? current.variant;
  const variantChanged = variant !== current.variant;
  const ttl = patch.ttl ?? (variantChanged ? defaultTtl(variant, patch.action) : current.ttl);
  const next = build(
    { id, message: patch.message ?? current.message, variant, ttl },
    {
      description: 'description' in patch ? patch.description : current.description,
      action: 'action' in patch ? patch.action : current.action,
      progress: 'progress' in patch ? patch.progress : current.progress,
    },
    current.count,
  );
  toasts = toasts.map((t) => (t.id === id ? next : t));
  emit();
  if (variantChanged || patch.ttl !== undefined) {
    clearTimer(id);
    if (ttl > 0) scheduleDismiss(id, ttl);
  }
}

type Msg<T> = string | ((value: T) => string);

export const toast = {
  success: (message: string, opts?: ToastOptions) => pushToast(message, 'success', opts),
  error: (message: string, opts?: ToastOptions) => pushToast(message, 'error', opts),
  info: (message: string, opts?: ToastOptions) => pushToast(message, 'info', opts),
  warning: (message: string, opts?: ToastOptions) => pushToast(message, 'warning', opts),
  update: (message: string, opts?: ToastOptions) => pushToast(message, 'update', opts),
  loading: (message: string, opts?: ToastOptions) => pushToast(message, 'loading', opts),
  /** Change a toast in place, e.g. progress ticks or loading → success. */
  change: updateToast,
  dismiss: dismissToast,
  /** One toast that follows a promise: loading, then success or error, in place. */
  promise<T>(
    work: Promise<T>,
    msgs: { loading: string; success: Msg<T>; error: Msg<unknown>; action?: ToastAction },
  ): Promise<T> {
    const id = pushToast(msgs.loading, 'loading');
    work.then(
      (value) => {
        updateToast(id, {
          variant: 'success',
          message: typeof msgs.success === 'function' ? msgs.success(value) : msgs.success,
          action: msgs.action,
        });
      },
      (err: unknown) => {
        updateToast(id, {
          variant: 'error',
          message: typeof msgs.error === 'function' ? msgs.error(err) : msgs.error,
          description: err instanceof Error ? err.message : undefined,
        });
      },
    );
    return work;
  },
};
```

## `src/components/Toaster.tsx`

```tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { AlertTriangleFilled, CircleCheckFilled, Spinner, X } from '@droidex/icons';
import {
  dismissToast,
  pauseAllToasts,
  resumeAllToasts,
  subscribeToasts,
  type ToastItem,
  type ToastVariant,
} from '../lib/toast';

// Toast (design system): a raised, borderless card. Colour lives only in the
// 16px status glyph, with no dots, side bars or tinted fills. Errors stay
// until dismissed. Toasts stack behind each other and fan out on hover.

const GAP = 8; // space-2 between expanded toasts
const PEEK = 10; // how much each older toast peeks out when collapsed
const VISIBLE = 3; // collapsed stack depth
const SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

// Filled status glyphs that the icon package doesn't have yet. Same grammar as
// CircleCheckFilled (9.25 radius, even-odd knockout); move them into
// packages/icons when they're adopted.
function CircleAlertFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5ZM12 7.25a.75.75 0 0 0-.75.75v4.75a.75.75 0 0 0 1.5 0V8a.75.75 0 0 0-.75-.75Zm0 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </svg>
  );
}
function CircleArrowUpFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Zm-.53 4.47-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v6.94a.75.75 0 0 0 1.5 0V9.56l2.22 2.22a.75.75 0 0 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0Z"
      />
    </svg>
  );
}

const GLYPH: Record<ToastVariant, ReactNode> = {
  success: <CircleCheckFilled className="h-4 w-4 text-success" />,
  error: <CircleAlertFilled className="h-4 w-4 text-danger" />,
  warning: <AlertTriangleFilled className="h-4 w-4 text-warning" />,
  update: <CircleArrowUpFilled className="h-4 w-4 text-link" />,
  loading: <Spinner className="h-4 w-4 animate-spin text-muted" />,
  info: null,
};

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const regionRef = useRef<HTMLOListElement>(null);

  useEffect(() => subscribeToasts(setItems), []);

  // Leaving the window pauses every countdown, so nothing expires unseen.
  useEffect(() => {
    const onBlur = () => {
      pauseAllToasts();
    };
    const onFocus = () => {
      if (!regionRef.current?.matches(':hover, :focus-within')) resumeAllToasts();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // ⌥T moves focus into the newest toast, so its action is reachable by keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyT') {
        const first = regionRef.current?.querySelector<HTMLElement>('[data-toast]');
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) setExpanded(false);
  }, [items.length]);

  const measure = useCallback((id: number, h: number) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
  }, []);

  // Newest first: index 0 sits at the front, closest to the corner.
  const ordered = [...items].reverse();
  const frontHeight = heights[ordered[0]?.id ?? -1] ?? 0;
  const offsets: number[] = [];
  ordered.reduce((acc, t, i) => {
    offsets[i] = acc;
    return acc + (heights[t.id] ?? 0) + GAP;
  }, 0);
  const regionHeight = expanded
    ? offsets[ordered.length - 1] + (heights[ordered[ordered.length - 1]?.id ?? -1] ?? 0)
    : frontHeight + Math.min(ordered.length - 1, VISIBLE - 1) * PEEK;

  return (
    <ol
      ref={regionRef}
      aria-label="Notifications"
      onMouseEnter={() => {
        setExpanded(true);
        pauseAllToasts();
      }}
      onMouseLeave={(e) => {
        if (e.currentTarget.contains(document.activeElement)) return;
        setExpanded(false);
        resumeAllToasts();
      }}
      onFocus={() => {
        setExpanded(true);
        pauseAllToasts();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setExpanded(false);
        resumeAllToasts();
      }}
      className="fixed bottom-11 right-4 z-[1300] m-0 w-[356px] list-none p-0 transition-[height] duration-300"
      style={{ height: ordered.length ? regionHeight : 0 }}
    >
      <AnimatePresence initial={false}>
        {ordered.map((t, i) => {
          const hiddenBehind = !expanded && i >= VISIBLE;
          return (
            <motion.li
              key={t.id}
              className="absolute bottom-0 right-0 w-full"
              style={{ zIndex: 100 - i, transformOrigin: 'bottom center' }}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{
                opacity: hiddenBehind ? 0 : 1,
                y: expanded ? -offsets[i] : -i * PEEK,
                scale: expanded ? 1 : 1 - i * 0.05,
              }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12, ease: 'easeIn' } }}
              transition={SPRING}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.05, right: 0.6 }}
              onDragEnd={(_e, info: PanInfo) => {
                if (info.offset.x > 80 || info.velocity.x > 500) dismissToast(t.id);
              }}
            >
              <Toast
                toast={t}
                // Older toasts fade their content while collapsed, so only a
                // clean edge peeks out behind the front one.
                contentVisible={expanded || i === 0}
                // Collapsed, every card takes the front card's height so the
                // peeking edges line up.
                height={!expanded && i > 0 ? frontHeight : undefined}
                onMeasure={measure}
              />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function Toast({
  toast: t,
  contentVisible,
  height,
  onMeasure,
}: {
  toast: ToastItem;
  contentVisible: boolean;
  height?: number;
  onMeasure: (id: number, h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onMeasure(t.id, el.offsetHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [t.id, onMeasure]);

  const glyph = GLYPH[t.variant];
  const persistent = t.ttl === 0;

  return (
    <motion.div
      animate={{ height: height ?? 'auto' }}
      transition={SPRING}
      className="overflow-hidden rounded-lg bg-raised shadow-lg"
    >
      <div
        ref={ref}
        data-toast
        tabIndex={-1}
        role={t.variant === 'error' ? 'alert' : 'status'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') dismissToast(t.id);
        }}
        className="group flex items-start gap-2.5 py-3 pl-3.5 pr-2.5 transition-opacity duration-200 select-none"
        style={{ opacity: contentVisible ? 1 : 0 }}
      >
        {glyph && (
          <span className="relative mt-px grid h-4 w-4 shrink-0 place-items-center">
            {/* The glyph cross-fades when a loading toast resolves in place. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={t.variant}
                className="grid place-items-center"
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(2px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.25, filter: 'blur(2px)' }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                {glyph}
              </motion.span>
            </AnimatePresence>
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5 text-[13px] font-medium leading-[18px] tracking-[-0.08px] text-primary">
            <span className="min-w-0 break-words">{t.message}</span>
            {t.count && t.count > 1 ? (
              <span className="shrink-0 text-[11px] font-normal tabular-nums text-muted">
                ×{t.count}
              </span>
            ) : null}
          </p>
          {t.description && (
            <p className="mt-0.5 text-[12px] leading-4 text-secondary">
              {t.description}
            </p>
          )}
          {t.progress !== undefined && (
            <div
              className="mt-2 h-0.5 overflow-hidden rounded-full bg-text/10"
              role="progressbar"
              aria-valuenow={Math.round(t.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-text/70 transition-[width] duration-300 ease-out"
                style={{ width: `${String(t.progress * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="-my-0.5 flex shrink-0 items-center gap-0.5">
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismissToast(t.id);
              }}
              className="h-6 rounded-sm bg-text/[0.06] px-2 text-[12px] font-medium text-primary transition-colors hover:bg-text/[0.11] active:scale-[0.97]"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dismissToast(t.id);
            }}
            className={`grid h-6 w-6 place-items-center rounded-sm text-muted transition-[opacity,background-color,color] hover:bg-text/[0.06] hover:text-primary focus-visible:opacity-100 ${
              persistent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
```

## `src/lib/toast.behaviour.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissAllToasts, pushToast, subscribeToasts, toast, type ToastItem } from './toast';

function latest(): ToastItem[] {
  let snapshot: ToastItem[] = [];
  subscribeToasts((t) => {
    snapshot = t;
  })();
  return snapshot;
}

test('a repeated toast counts up instead of stacking', () => {
  dismissAllToasts();
  const a = pushToast('Copied link', 'success', 0);
  const b = pushToast('Copied link', 'success', 0);
  assert.equal(a, b);
  assert.equal(latest().length, 1);
  assert.equal(latest()[0]?.count, 2);
});

test('errors stay until dismissed and actions lengthen success toasts', () => {
  dismissAllToasts();
  toast.error('Could not push to origin');
  toast.success('Session archived', { action: { label: 'Undo', onClick: () => undefined } });
  const [err, ok] = latest();
  assert.equal(err?.ttl, 0);
  assert.equal(ok?.ttl, 6000);
  dismissAllToasts();
});

test('a promise toast resolves in place', async () => {
  dismissAllToasts();
  await toast.promise(Promise.resolve(460), {
    loading: 'Creating pull request',
    success: (n) => `Pull request #${String(n)} opened`,
    error: 'Could not open the pull request',
  });
  await Promise.resolve();
  const [only] = latest();
  assert.equal(latest().length, 1);
  assert.equal(only?.variant, 'success');
  assert.equal(only?.message, 'Pull request #460 opened');
  dismissAllToasts();
});
```
