import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import type { SessionActivityStatus } from '../../lib/sidebarActivity';
import { finishedSteps, type ThreadRow } from './threadBoard';
import type { ProjectStep } from './types';

/* The lead owns step progress; a linked thread supplies its activity and opens
   the conversation without changing the step's state. The Plan tab names the
   list, so it carries no heading of its own. */

export function ProjectPlan({
  plan,
  rows,
  onOpenThread,
}: {
  plan: readonly ProjectStep[];
  rows: readonly ThreadRow[];
  onOpenThread: (appSessionId: string) => void;
}) {
  const byThread = new Map(rows.map((row) => [row.appSessionId, row]));
  return (
    <section aria-label="Project plan" className="px-3 pb-1 pt-1">
      {groupByMilestone(plan).map(([milestone, steps]) => (
        <div key={milestone} className="pb-1">
          {milestone && <h3 className="px-2 pb-1 pt-3 text-label text-muted">{milestone}</h3>}
          {steps.map((step) => (
            <PlanRow
              key={step.id}
              step={step}
              row={step.threadAppSessionId ? byThread.get(step.threadAppSessionId) : undefined}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

/** One segment per step, so progress reads at a glance above the tabs. */
export function PlanMeter({ plan }: { plan: readonly ProjectStep[] }) {
  return (
    <div
      role="img"
      aria-label={`${String(finishedSteps(plan))} of ${String(plan.length)} steps done`}
      className="mt-3 flex gap-0.5"
    >
      {plan.map((step) => (
        <span
          key={step.id}
          className={`h-1 flex-1 rounded-full ${STEP_TONE[step.state ?? 'planned']}`}
        />
      ))}
    </div>
  );
}

function PlanRow({
  step,
  row,
  onOpenThread,
}: {
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
      className="group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/50 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="flex w-3.5 shrink-0 items-center justify-center pt-0.5">
        <span role="img" aria-label={step.state ?? 'planned'} title={step.state ?? 'planned'}>
          <ActivityStatusGlyph status={PLANNED_STATUS[step.state ?? 'planned']} decorative />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-body ${
            step.state === 'done' ? 'text-muted' : 'text-secondary group-hover:text-primary'
          }`}
        >
          {step.title}
        </span>
        {detail && (
          <span
            className={`mt-0.5 block truncate text-caption ${
              row?.live === true ? 'shimmer-text font-medium' : 'text-muted'
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

const STEP_TONE: Record<NonNullable<ProjectStep['state']>, string> = {
  planned: 'bg-active',
  doing: 'bg-muted/50',
  review: 'bg-muted/50',
  done: 'bg-success',
  blocked: 'bg-warning',
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
