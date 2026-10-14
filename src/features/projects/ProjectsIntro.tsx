import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { Button } from '../../components/ui/Button';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { dismissSidebarCard, loadSidebarCardSeen } from '../../lib/sidebarCards';
import { resolveNewChatCwd } from '../../lib/workspaces';
import { ProjectsBetaNote } from './ProjectsBetaNote';
import { INTRO_WIDTH, PROJECTS_INTRO_CARD_ID, projectsIntroPosition } from './projectsIntroState';

const EASE = [0.16, 1, 0.3, 1] as const;

interface Anchor {
  top: number;
  right: number;
  height: number;
}

/* The one-time "what's new" for Projects, beside the sidebar's Projects entry.
   It waits while another announcement (the first-run welcome) is up, and goes
   once it is closed, a project is started from it, or the Projects view is
   opened, since then it has done its job. */
export function ProjectsIntro({
  anchorRef,
  held,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  held: boolean;
}) {
  const dispatch = useStoreDispatch();
  const [unseen, setUnseen] = useState(() => !loadSidebarCardSeen(PROJECTS_INTRO_CARD_ID));
  const visible = unseen && !held;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const onProjects = useStoreSelector((state) => state.mainView === 'projects');
  const cwd = useStoreSelector((state) =>
    resolveNewChatCwd(
      state.activeAppSessionId ? state.sessions[state.activeAppSessionId] : undefined,
      state.draftChat,
    ),
  );

  const dismiss = () => {
    setUnseen(false);
    dismissSidebarCard(PROJECTS_INTRO_CARD_ID);
  };

  // Opening Projects counts as seeing it, even while the welcome card holds it back.
  useEffect(() => {
    if (unseen && onProjects) dismiss();
  }, [unseen, onProjects]);

  // Glued to the entry while it shows: the sidebar can resize or collapse.
  useEffect(() => {
    if (!visible) return;
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      setAnchor(
        rect && rect.width > 0 ? { top: rect.top, right: rect.right, height: rect.height } : null,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible, anchorRef]);

  if (typeof document === 'undefined') return null;
  const position = anchor ? projectsIntroPosition(anchor, window.innerHeight) : null;
  return createPortal(
    <AnimatePresence>
      {visible && position && (
        <motion.div
          initial={{ opacity: 0, x: -8, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -4, scale: 0.98 }}
          transition={{ duration: 0.24, ease: EASE }}
          style={{ position: 'fixed', top: position.top, left: position.left, width: INTRO_WIDTH }}
          className="z-50"
        >
          <div className="relative overflow-hidden rounded-xl bg-raised shadow-lg">
            <ProjectGlyph />
            <div className="px-3.5 pb-3.5 pt-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-subheading text-primary">Projects</span>
                <span className="text-label text-muted">Beta</span>
              </div>
              <p className="mt-1 text-body text-muted">
                Give one chat a goal. It plans the work and hands the parts that can run at once to
                agents on any harness, which report back as they finish.
              </p>
              <ProjectsBetaNote className="mt-2 text-body text-muted" />
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  dismiss();
                  dispatch({ type: 'START_CHAT', cwd, executionMode: 'local', project: true });
                }}
              >
                Start a project
              </Button>
            </div>
            {/* Button's own `relative` would win over an `absolute` passed to it. */}
            <span className="absolute right-2 top-2">
              <Button variant="ghost" size="sm" icon={X} aria-label="Dismiss" onClick={dismiss} />
            </span>
          </div>
          {/* Caret pointing back at the Projects entry, filled like the card it
              extends */}
          <span
            aria-hidden
            className="absolute -left-1.5 h-2.5 w-2.5 rotate-45 bg-raised"
            style={{ top: position.caretTop }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* A project in miniature, in the app's own marks: the chat that leads, and two
   threads branching from it. */
function ProjectGlyph() {
  const row = (width: string) => <span className={`h-1.5 rounded-full bg-muted/30 ${width}`} />;
  return (
    <div className="relative flex h-24 flex-col justify-center gap-2 bg-bg px-6">
      <div className="flex items-center gap-2">
        <ActivityStatusGlyph status="ready" decorative />
        {row('w-32')}
      </div>
      {['w-24', 'w-20'].map((width) => (
        <div key={width} className="flex items-center gap-2 pl-2">
          {/* The branch connector: a filled L where the border version drew two
              edges, so the illustration carries no surface borders. */}
          <span className="relative -mt-4 h-4 w-3 shrink-0">
            <span className="absolute bottom-0 left-0 h-4 w-px bg-muted/40" />
            <span className="absolute bottom-0 left-0 h-px w-3 bg-muted/40" />
          </span>
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted">
            <ActivityStatusGlyph status="working" decorative />
          </span>
          {row(width)}
        </div>
      ))}
    </div>
  );
}
