// The new-chat home (spec §4): every new chat, Chat or Design, centres one
// composer. Its heading sits above and its starting points below, and the
// Chat | Design switch swaps only those, so the composer never moves. The first
// send carries the composer to the foot of its column.

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrandMark } from './BrandMark';
import { Button } from './ui/Button';
import { ProductSwitch } from './composer/ProductSwitch';
import { SKETCH_INK as INK, SKETCH_MARK as MARK, StarterTiles, type Starter } from './StarterTile';
import type { NewChatStart } from './chatViewState';
import { useStoreApi, useStoreDispatch } from '../hooks/useStore';
import { preloadLazySurface } from '../lib/chunkPreloader';
import { LazyCanvasTabName, LazyRecentCanvases } from '../lib/lazySurfaces';
import { DESIGN_STARTERS, StarterSketch } from '../features/canvas/designStarters';

// Each entry seeds the beginning of a prompt (it never sends), so the user
// just continues typing the specifics.
const CHAT_STARTERS: readonly Starter[] = [
  {
    label: 'Explore',
    hint: 'understand this codebase',
    prompt: 'Explore and understand this codebase: ',
    sketch: (
      <span className="flex w-24 flex-col gap-2">
        {[
          { indent: '', tone: INK, width: 'w-12' },
          { indent: 'pl-3', tone: INK, width: 'w-9' },
          { indent: 'pl-3', tone: MARK, width: 'w-14' },
        ].map(({ indent, tone, width }) => (
          <span key={width} className={`flex items-center gap-1.5 ${indent}`}>
            <span className={`size-2 rounded-xs ${tone}`} />
            <span className={`h-1.5 rounded-full ${width} ${tone}`} />
          </span>
        ))}
      </span>
    ),
  },
  {
    label: 'Build',
    hint: 'a new feature, app, or tool',
    prompt: 'Build a new feature: ',
    sketch: (
      <span className="grid grid-cols-3 gap-1">
        {[INK, INK, INK, INK, INK, MARK].map((tone, index) => (
          <span key={index} className={`size-4 rounded-xs ${tone}`} />
        ))}
      </span>
    ),
  },
  {
    label: 'Review',
    hint: 'code and suggest changes',
    prompt: 'Review this code and suggest changes: ',
    sketch: (
      <span className="flex w-24 flex-col gap-1.5">
        <span className={`h-1.5 w-20 rounded-full ${INK}`} />
        <span className={`h-1.5 w-14 rounded-full ${INK}`} />
        <span className={`ml-5 mt-0.5 h-4 w-16 rounded-md ${MARK}`} />
      </span>
    ),
  },
  {
    label: 'Fix',
    hint: 'issues and failing tests',
    prompt: 'Fix issues and failures: ',
    sketch: (
      <span className="flex w-20 flex-col gap-2">
        {[INK, INK, MARK].map((tone, index) => (
          <span key={index} className="flex items-center gap-1.5">
            <span className={`size-2 shrink-0 rounded-full ${tone}`} />
            <span className={`h-1.5 flex-1 rounded-full ${INK}`} />
          </span>
        ))}
      </span>
    ),
  },
];

const DESIGN_STARTER_TILES: readonly Starter[] = DESIGN_STARTERS.map((starter) => ({
  ...starter,
  sketch: <StarterSketch kind={starter.sketch} />,
}));

function daypart(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

// A fresh chat picks one of these at random so the home doesn't feel static.
// Only the brand mark uses the pixel font; the greeting stays in the normal UI
// font, large and readable.
const GREETINGS: ((folder?: string) => string)[] = [
  (folder) => `Good ${daypart()}. What should we build${folder ? ` in ${folder}` : ''}?`,
  () => 'What do you want to build today?',
  () => 'Ready when you are. Pick a starting point, or just type.',
];

// What a design's first send opens, fetched while its home is up so the
// board and its column arrive whole instead of in pieces.
function warmDesign() {
  for (const surface of [
    'recentCanvases',
    'canvas',
    'canvasChatBootstrap',
    'designColumnHeader',
    'canvasColumnTabs',
  ] as const) {
    preloadLazySurface(surface);
  }
}

function swapKey(start: NewChatStart): string {
  return start.kind === 'design' ? `design:${start.canvasId ?? 'new'}` : start.kind;
}

/**
 * What a switch replaces cross-fades in place, with a 2px blur (feel.md):
 * both sit in one grid cell while it plays, so nothing around them moves.
 */
function Swap({
  start,
  align,
  children,
}: {
  start: NewChatStart;
  align: 'items-end' | 'items-start';
  children: ReactNode;
}) {
  return (
    <div className={`grid w-full ${align}`}>
      <AnimatePresence initial={false}>
        <motion.div
          key={swapKey(start)}
          className="col-start-1 row-start-1 flex min-w-0 flex-col items-center"
          initial={{ opacity: 0, filter: 'blur(2px)' }}
          animate={{
            opacity: 1,
            filter: 'blur(0px)',
            transition: { duration: 0.2, ease: 'easeOut', delay: 0.04 },
          }}
          exit={{ opacity: 0, filter: 'blur(2px)', transition: { duration: 0.12, ease: 'easeIn' } }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Above the composer: what this new chat is for, resting on the composer. */
export function NewChatHeading({ start, folder }: { start: NewChatStart; folder?: string }) {
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  return (
    // A short tile scrolls the heading instead of clipping its top.
    <div className="flex min-h-full flex-col items-center justify-end px-8 pb-8 pt-6">
      <div className="droid-rise">
        <BrandMark size={34} className="text-accent" />
      </div>
      <div className="droid-rise mt-6 w-full" style={{ animationDelay: '90ms' }}>
        <Swap start={start} align="items-end">
          <h1 className="max-w-lg text-balance text-center text-title text-primary">
            {start.kind === 'chat' && greeting(folder)}
            {start.kind === 'project' && 'Start a project'}
            {start.kind === 'design' &&
              (start.canvasId === null ? (
                'What should we design?'
              ) : (
                <>
                  New chat on{' '}
                  <Suspense fallback="this canvas">
                    <LazyCanvasTabName canvasId={start.canvasId} fallback="this canvas" />
                  </Suspense>
                </>
              ))}
          </h1>
          {start.kind === 'project' && (
            <p className="mt-3 max-w-md text-pretty text-center text-body text-muted">
              Say what you want done. Its chat plans the work, asks you what it needs to know, and
              runs the parts that can go in parallel as threads.
            </p>
          )}
        </Swap>
      </div>
    </div>
  );
}

/**
 * Below the composer: the Chat | Design switch where the tab can hold either,
 * then this product's starting points.
 */
export function NewChatStarters({
  start,
  switchable,
  onPreview,
}: {
  start: NewChatStart;
  switchable: boolean;
  onPreview: (prompt: string | null) => void;
}) {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const product = start.kind === 'design' ? 'design' : 'chat';
  useEffect(() => {
    if (product === 'design') warmDesign();
  }, [product]);
  const startChatInstead = () => {
    const draft = store.getState().draftChat;
    dispatch({
      type: 'START_CHAT',
      cwd: draft?.cwd ?? '',
      executionMode: draft?.executionMode ?? 'local',
      ...(draft?.branch ? { branch: draft.branch } : {}),
    });
  };

  return (
    // Grows a little more than the view above it, which lifts the composer
    // just above the middle of the page, where the eye expects it.
    <div className="scroll-fade-y min-h-0 overflow-y-auto px-6" style={{ flex: '1.25 1 0%' }}>
      <div
        className="droid-rise mx-auto flex w-full flex-col items-center gap-6 pb-10 pt-2"
        style={{ maxWidth: 'calc(42rem + 44px)', animationDelay: '160ms' }}
      >
        {switchable && (
          // Reaching for the switch starts Design's load before the press.
          <div onPointerEnter={warmDesign} onFocus={warmDesign}>
            <ProductSwitch
              product={product}
              onSwitch={(mode) => {
                dispatch({ type: 'SET_DRAFT_PRODUCT', mode });
              }}
            />
          </div>
        )}
        <Swap start={start} align="items-start">
          {start.kind === 'chat' && (
            <div className="w-full">
              <StarterTiles
                starters={CHAT_STARTERS}
                onPick={(prompt) => {
                  dispatch({ type: 'SEED_COMPOSER', text: prompt });
                }}
                onPreview={onPreview}
              />
            </div>
          )}
          {start.kind === 'design' && start.canvasId === null && (
            <div className="flex w-full flex-col gap-10">
              <StarterTiles
                starters={DESIGN_STARTER_TILES}
                onPick={(prompt) => {
                  dispatch({ type: 'SEED_COMPOSER', text: prompt, replace: true });
                }}
                onPreview={onPreview}
              />
              <Suspense fallback={null}>
                <LazyRecentCanvases />
              </Suspense>
            </div>
          )}
          {start.kind === 'project' && (
            <Button variant="ghost" onClick={startChatInstead}>
              Start a chat instead
            </Button>
          )}
        </Swap>
      </div>
    </div>
  );
}
