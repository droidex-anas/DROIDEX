import { LEDGER_LIMITS } from './store.js';
import type { ProjectStep } from './types.js';

/** Retains existing identities through reordering; explicit ids also survive renaming. */
export function planFromSteps(
  steps: readonly (Omit<ProjectStep, 'id'> & { id?: string })[],
  isMember: (appSessionId: string) => boolean,
  previous: readonly ProjectStep[],
  lastStepId = 0,
): ProjectStep[] {
  const used = new Set<string>();
  const reserved = new Set(steps.flatMap((step) => (step.id ? [step.id] : [])));
  let nextId = Math.max(lastStepId, ...previous.map((step) => stepNumber(step.id)));
  return steps.map((step) => {
    if (step.threadAppSessionId && !isMember(step.threadAppSessionId))
      throw new Error('Thread is outside this project.');
    const existing = step.id
      ? previous.find((candidate) => candidate.id === step.id)
      : previous.find((candidate) => candidate.title === step.title && !used.has(candidate.id));
    let id = step.id ?? existing?.id;
    if (!id) {
      do {
        id = String(++nextId);
      } while (reserved.has(id) || used.has(id));
    }
    if (used.has(id)) throw new Error(`Plan step id "${id}" appears more than once.`);
    used.add(id);
    return {
      id,
      title: step.title.slice(0, LEDGER_LIMITS.stepTitle),
      state: step.state ?? existing?.state ?? 'planned',
      ...(step.milestone
        ? { milestone: step.milestone.slice(0, LEDGER_LIMITS.stepMilestone) }
        : {}),
      ...(step.threadAppSessionId ? { threadAppSessionId: step.threadAppSessionId } : {}),
      ...(step.note ? { note: step.note.slice(0, LEDGER_LIMITS.stepNote) } : {}),
    };
  });
}

/** The plan step a spawn says it carries, by its number or its exact title. */
export function findPlanStep(plan: readonly ProjectStep[], step: string): ProjectStep {
  const wanted = step.trim();
  const found = plan.find((candidate) => candidate.id === wanted || candidate.title === wanted);
  if (!found) {
    throw new Error(
      plan.length
        ? `No plan step called "${wanted}". Call plan_set first, then spawn for a step it holds.`
        : 'This project has no plan yet. Call plan_set with the steps you mean to take, then spawn for one of them.',
    );
  }
  return found;
}

/** A step id's place in the numbering when it is a whole number up to a million, else 0. */
export function stepNumber(id: string): number {
  return /^[1-9]\d{0,5}$/.test(id) ? Number(id) : 0;
}
