import { Check } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import type { SessionActivityStatus } from '../../lib/sidebarActivity';
import type { ThreadRow } from './threadBoard';
import type { ProjectStep } from './types';

/* The plan the project's chat keeps: what it means to do, in order, grouped the
   way a mission groups its features. A step pointed at a thread shows that
   conversation's real state — the same mark the thread row wears — so the table
   can never report progress the app cannot see. A step with no thread shows
   only what the chat said about it. */

export function ProjectPlan({
  plan,
  rows,
  onOpenThread,
}: {
  plan: readonly ProjectStep[];
  rows: readonly ThreadRow[];
  onOpenThread: (appSessionId: string) => void;
}) {
  if (plan.length === 0) return null;
  const byThread = new Map(rows.map((row) => [row.appSessionId, row]));
  const milestones = groupByMilestone(plan);
  let number = 0;

  return (
    <section aria-label="Project plan" className="px-2 pb-1 pt-1">
      {milestones.map(([milestone, steps]) => (
        <div key={milestone} className="pb-1">
          {milestone && (
            <span className="block px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-droid-text-muted/70">
              {milestone}
            </span>
          )}
          {steps.map((step) => {
            number += 1;
            const row = step.threadAppSessionId ? byThread.get(step.threadAppSessionId) : undefined;
            const done = row ? false : step.state === 'done';
            return (
              <PlanRow
                key={step.id}
                index={number}
                step={step}
                row={row}
                done={done}
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
  done,
  onOpenThread,
}: {
  index: number;
  step: ProjectStep;
  row: ThreadRow | undefined;
  done: boolean;
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
        <StepMark row={row} state={step.state} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] ${
            done
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

// A step's mark is its thread's, so the plan and the thread list never disagree.
function StepMark({ row, state }: { row: ThreadRow | undefined; state?: ProjectStep['state'] }) {
  if (row?.live === true) {
    return (
      <span
        aria-label="working"
        className="h-3 w-3 rounded-full border-[1.5px] border-droid-text border-r-transparent motion-safe:animate-spin-slow"
      />
    );
  }
  if (row) return <ActivityStatusGlyph status={row.status} />;
  if (state === 'done') return <Check className="h-3 w-3 text-droid-text-muted/60" />;
  return <ActivityStatusGlyph status={PLANNED_STATUS[state ?? 'planned']} />;
}

const PLANNED_STATUS: Record<NonNullable<ProjectStep['state']>, SessionActivityStatus> = {
  planned: 'ready',
  doing: 'working',
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
