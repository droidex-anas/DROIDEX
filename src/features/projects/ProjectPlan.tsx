import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { SidebarSectionHeading } from '../../components/SidebarSectionHeading';
import type { SessionActivityStatus } from '../../lib/sidebarActivity';
import type { ThreadRow } from './threadBoard';
import type { ProjectStep } from './types';

/* The lead owns step progress; a linked thread supplies its activity and opens
   the conversation without changing the step's state. */

export function ProjectPlan({
  plan,
  rows,
  open,
  onToggle,
  onOpenThread,
}: {
  plan: readonly ProjectStep[];
  rows: readonly ThreadRow[];
  open: boolean;
  onToggle: () => void;
  onOpenThread: (appSessionId: string) => void;
}) {
  if (plan.length === 0) return null;
  const byThread = new Map(rows.map((row) => [row.appSessionId, row]));
  const milestones = groupByMilestone(plan);
  const finished = plan.filter((step) => step.state === 'done').length;
  let number = 0;

  return (
    <section aria-label="Project plan" className="px-2 pb-1 pt-1">
      <SidebarSectionHeading
        label={`Plan · ${String(finished)} of ${String(plan.length)} done`}
        open={open}
        onToggle={onToggle}
      />
      {open &&
        milestones.map(([milestone, steps]) => (
          <div key={milestone} className="pb-1">
            {milestone && (
              <span className="block px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-droid-text-muted/70">
                {milestone}
              </span>
            )}
            {steps.map((step) => {
              number += 1;
              const row = step.threadAppSessionId
                ? byThread.get(step.threadAppSessionId)
                : undefined;
              return (
                <PlanRow
                  key={step.id}
                  index={number}
                  step={step}
                  row={row}
                  onOpenThread={onOpenThread}
                />
              );
            })}
          </div>
        ))}
    </section>
  );
}

function PlanRow({
  index,
  step,
  row,
  onOpenThread,
}: {
  index: number;
  step: ProjectStep;
  row: ThreadRow | undefined;
  onOpenThread: (appSessionId: string) => void;
}) {
  const detail = row?.detail ?? step.note;
  const open = () => {
    if (row) onOpenThread(row.appSessionId);
  };
  return (
    <button
      type="button"
      data-testid="plan-step"
      disabled={!row}
      onClick={open}
      className="group flex w-full items-start gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-droid-elevated/50 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="w-4 shrink-0 pt-px text-right text-[11px] tabular-nums text-droid-text-muted/70">
        {index}
      </span>
      <span className="flex w-3.5 shrink-0 items-center justify-center pt-px">
        <span role="img" aria-label={step.state ?? 'planned'} title={step.state ?? 'planned'}>
          <ActivityStatusGlyph status={PLANNED_STATUS[step.state ?? 'planned']} decorative />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] ${
            step.state === 'done'
              ? 'text-droid-text-muted line-through decoration-droid-text-muted/40'
              : 'text-droid-text-secondary group-hover:text-droid-text'
          }`}
        >
          {step.title}
        </span>
        {detail && (
          <span
            className={`mt-0.5 block truncate text-[12px] leading-4 ${
              row?.live === true ? 'shimmer-text font-medium' : 'text-droid-text-muted'
            }`}
          >
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}

const PLANNED_STATUS: Record<NonNullable<ProjectStep['state']>, SessionActivityStatus> = {
  planned: 'ready',
  doing: 'working',
  review: 'working',
  done: 'settled',
  blocked: 'input',
};

function groupByMilestone(plan: readonly ProjectStep[]): [string, ProjectStep[]][] {
  const groups = new Map<string, ProjectStep[]>();
  for (const step of plan) {
    const key = step.milestone ?? '';
    const existing = groups.get(key);
    if (existing) existing.push(step);
    else groups.set(key, [step]);
  }
  return [...groups.entries()];
}
