import { AnimatePresence, motion } from 'framer-motion';
import { DitherArt, type DitherSource } from './DitherArt';
import { useNewChatLook, type NewChatLook } from './newChatLook';
import { useDraftHarness } from './useDraftHarness';

const FADE = { duration: 0.8, ease: [0.22, 1, 0.36, 1] } as const;

// Keeps the greeting and composer readable over any photo.
const PHOTO_SCRIM =
  'radial-gradient(ellipse 60% 55% at 50% 48%, color-mix(in srgb, var(--bg) 78%, transparent), color-mix(in srgb, var(--bg) 30%, transparent))';

type Layer = { key: string; source: DitherSource } | { key: string; photo: string };

function backdropLayer(look: NewChatLook, harness: string): Layer | null {
  if (look.backdrop === 'none') return null;
  if (look.backdrop !== 'custom') {
    return {
      key: `${look.backdrop}:${harness}`,
      source: { kind: 'preset', preset: look.backdrop },
    };
  }
  if (!look.backgroundImage) return null;
  if (!look.ditherImage) return { key: 'photo', photo: look.backgroundImage };
  return { key: `image:${harness}`, source: { kind: 'image', url: look.backgroundImage } };
}

// Artwork behind the home of a chat that has not started. Each harness gets
// its own layer, so switching harness cross-fades the old light into the new
// one; the first send fades it all away. Needs an isolated, positioned parent.
export function NewChatBackdrop({ visible }: { visible: boolean }) {
  const look = useNewChatLook();
  const harness = useDraftHarness();
  const layer = visible ? backdropLayer(look, harness) : null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <AnimatePresence>
        {layer && (
          <motion.div
            key={layer.key}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
          >
            {'photo' in layer ? (
              <>
                <img src={layer.photo} alt="" className="size-full object-cover" />
                <div className="absolute inset-0" style={{ background: PHOTO_SCRIM }} />
              </>
            ) : (
              <DitherArt source={layer.source} provider={harness} cellPx={3} gapPx={1} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
