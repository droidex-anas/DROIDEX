import { motion } from 'framer-motion';
import { SquarePen, X } from '@droidex/icons';
import { Button } from './ui/Button';

const EASE = [0.16, 1, 0.3, 1] as const;

// Bundled nebula artwork for the header. Resolved through URL (not a static
// import) so node-based render tests can load this module without an asset
// loader; Vite still emits the file with a hashed name in production builds.
const WELCOME_IMAGE_URL = new URL('../assets/welcome-nebula.jpg', import.meta.url).href;

// Dismissal key for the welcome card; future sidebar announcements get their
// own id so they show even after the user dismissed this one.
export const SIDEBAR_WELCOME_CARD_ID = 'welcome-to-droidex';

// First-run card pinned above the sidebar Settings button: nebula header,
// one-line pitch, and a primary action that starts a chat. The motion wrapper
// owns entrance and the height-collapse exit so the footer reflows smoothly;
// Sidebar gates visibility and persistence.
export function SidebarWelcomeCard({
  onStart,
  onDismiss,
}: {
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="mb-2 overflow-hidden"
    >
      <div className="relative overflow-hidden rounded-xl bg-raised shadow-lg">
        {/* Visual: nebula artwork melting into the card body, a multi-stop
            blend instead of a hard edge. */}
        <div className="relative h-28 overflow-hidden">
          <img src={WELCOME_IMAGE_URL} alt="" className="h-full w-full scale-105 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-elevated via-elevated/35 to-transparent" />
        </div>

        <div className="relative -mt-6 px-3.5 pb-3">
          <span className="text-body-strong text-primary">Welcome to DROIDEX</span>
          <p className="mt-1 text-body text-muted">
            Chats, workspaces and missions live here. Start a chat and put Droid to work.
          </p>
          <Button variant="primary" size="sm" icon={SquarePen} onClick={onStart} className="mt-2.5">
            Start a chat
          </Button>
        </div>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="absolute right-2 top-2 rounded-sm bg-raised/70 p-1 text-secondary backdrop-blur-sm transition-colors hover:bg-raised hover:text-primary"
        >
          <X className="size-icon-sm" />
        </button>
      </div>
    </motion.div>
  );
}
