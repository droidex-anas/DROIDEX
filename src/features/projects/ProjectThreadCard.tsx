import { motion } from 'framer-motion';
import type { ProjectThread } from './types';

export function ProjectThreadCard({ thread, controller }: { thread: ProjectThread; controller: boolean }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-droid-border/60 bg-droid-elevated/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{thread.title}</span>
            {controller && <span className="text-[10px] text-droid-text-muted">controller</span>}
          </div>
          {thread.task && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-droid-text-muted">{thread.task}</p>}
        </div>
        <State state={thread.state} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-droid-text-muted">
        <Chip>{thread.provider}</Chip>
        {thread.model && <Chip>{thread.model}</Chip>}
        {thread.reasoning && <Chip>{thread.reasoning}</Chip>}
        <Chip>{thread.autonomy}</Chip>
      </div>
      {thread.result && <div className="mt-3 border-t border-droid-border/50 pt-3 text-[11px] leading-4 text-droid-text-secondary">{thread.result}</div>}
    </motion.div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg border border-droid-border/50 px-2 py-1">{children}</span>;
}
function State({ state }: { state: ProjectThread['state'] }) {
  return <span className="rounded-full bg-droid-bg/60 px-2 py-0.5 text-[10px] text-droid-text-muted">{state}</span>;
}
