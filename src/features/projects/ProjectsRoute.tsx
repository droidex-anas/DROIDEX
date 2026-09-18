import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCirclePlus } from '@droidex/icons';
import { bridge } from '../../lib/bridge';
import type { ServerEvent } from '../../types/bridge';
import type { Project } from './types';

export function ProjectsRoute() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const off = bridge.subscribe((event: ServerEvent) => {
      if (event.type !== 'projects.updated') return;
      setProjects(event.projects);
      setSelectedId((current) => current ?? event.projects[0]?.id ?? null);
    });
    bridge.send({ type: 'project.list' });
    return off;
  }, []);

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 bg-droid-bg text-droid-text">
      <aside className="w-[248px] shrink-0 border-r border-droid-border/60 px-3 py-12">
        <div className="mb-3 px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-droid-text-muted">
          Projects
        </div>
        <div className="space-y-1">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => setSelectedId(project.id)}
              className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                selected?.id === project.id
                  ? 'bg-droid-active text-droid-text'
                  : 'text-droid-text-secondary hover:bg-droid-elevated'
              }`}
            >
              <div className="truncate text-[13px] font-medium">{project.title}</div>
              <div className="mt-0.5 text-[11px] text-droid-text-muted">{project.threads.length} threads</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto px-8 pb-8 pt-12">
        {!selected ? (
          <div className="mx-auto flex max-w-xl flex-col items-center pt-24 text-center">
            <div className="mb-4 rounded-2xl border border-droid-border/60 bg-droid-elevated/50 p-3">
              <MessageCirclePlus className="h-5 w-5 text-droid-text-secondary" />
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight">Local projects</h1>
            <p className="mt-2 max-w-md text-[13px] leading-5 text-droid-text-muted">
              One controller, many harness threads. Threads sleep when idle and wake only when work reaches them.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            <div className="mb-8">
              <h1 className="text-[22px] font-semibold tracking-tight">{selected.title}</h1>
              <p className="mt-1 truncate text-[12px] text-droid-text-muted">{selected.cwd || 'No workspace'}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {selected.threads.map((thread, index) => (
                <motion.div
                  key={thread.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(index * 0.025, 0.15) }}
                  className="rounded-2xl border border-droid-border/60 bg-droid-elevated/30 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-[13px] font-medium">{thread.title}</div>
                    <span className="rounded-full bg-droid-bg/70 px-2 py-0.5 text-[10px] text-droid-text-muted">
                      {thread.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-droid-text-muted">
                    <span className="rounded-lg border border-droid-border/50 px-2 py-1">{thread.provider}</span>
                    {thread.modelId && <span className="rounded-lg border border-droid-border/50 px-2 py-1">{thread.modelId}</span>}
                    {thread.reasoningEffort && <span className="rounded-lg border border-droid-border/50 px-2 py-1">{thread.reasoningEffort}</span>}
                    <span className="rounded-lg border border-droid-border/50 px-2 py-1">{thread.autonomy}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
