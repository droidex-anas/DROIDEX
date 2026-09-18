import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCirclePlus } from '@droidex/icons';
import { bridge } from '../../lib/bridge';
import type { ServerEvent } from '../../types/bridge';
import { ProjectThreadCard } from './ProjectThreadCard';
import type { Project } from './types';

export function ProjectsRoute() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const off = bridge.subscribe((event: ServerEvent) => {
      if (event.type !== 'projects.updated') return;
      setProjects(event.projects);
      setSelectedId((id) => id && event.projects.some((project) => project.id === id) ? id : event.projects[0]?.id ?? null);
    });
    bridge.send({ type: 'projects.list', requestId: crypto.randomUUID() });
    return off;
  }, []);

  const project = useMemo(() => projects.find((item) => item.id === selectedId) ?? projects[0], [projects, selectedId]);

  return <div className="flex h-full min-h-0 bg-droid-bg text-droid-text">
    <aside className="w-[236px] shrink-0 border-r border-droid-border/60 px-3 py-10">
      <div className="mb-3 px-2 text-[11px] font-medium text-droid-text-muted">Projects</div>
      <div className="space-y-1">{projects.map((item) =>
        <button key={item.id} onClick={() => setSelectedId(item.id)}
          className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${project?.id === item.id ? 'bg-droid-active' : 'hover:bg-droid-elevated'}`}>
          <div className="truncate text-[13px] font-medium">{item.title}</div>
          <div className="mt-0.5 text-[10px] text-droid-text-muted">{item.threads.length} threads</div>
        </button>)}</div>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto px-8 pb-10 pt-10">
      {!project ? <Empty /> : <div className="mx-auto max-w-5xl">
        <div className="mb-7">
          <h1 className="text-[21px] font-semibold tracking-tight">{project.title}</h1>
          <div className="mt-1 truncate text-[11px] text-droid-text-muted">{project.cwd}</div>
        </div>
        <AnimatePresence mode="popLayout">
          <motion.div layout className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {project.threads.map((thread) =>
              <ProjectThreadCard key={thread.id} thread={thread} controller={thread.id === project.controllerId} />)}
          </motion.div>
        </AnimatePresence>
      </div>}
    </main>
  </div>;
}

function Empty() {
  return <div className="mx-auto flex max-w-md flex-col items-center pt-24 text-center">
    <div className="mb-4 rounded-2xl border border-droid-border/60 bg-droid-elevated/40 p-3"><MessageCirclePlus className="h-5 w-5 text-droid-text-secondary" /></div>
    <h1 className="text-[20px] font-semibold tracking-tight">Projects</h1>
    <p className="mt-2 text-[12px] leading-5 text-droid-text-muted">A local workspace where one agent can coordinate independent harness threads without carrying their transcripts.</p>
  </div>;
}
