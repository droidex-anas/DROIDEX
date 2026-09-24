import { LEDGER_LIMITS } from './store.js';
import type { ProjectStep } from './types.js';

/**
 * The plan a lead writes, as the ledger stores it: numbered in order and cut to
 * the lengths the ledger loads. A step that names a thread must name a member,
 * so the table can follow that conversation's real state instead of a claim.
 */
export function planFromSteps(
  steps: readonly Omit<ProjectStep, 'id'>[],
  isMember: (appSessionId: string) => boolean,
): ProjectStep[] {
  return steps.map((step, index) => {
    if (step.threadAppSessionId && !isMember(step.threadAppSessionId))
      throw new Error('Thread is outside this project.');
    return {
      id: String(index + 1),
      title: step.title.slice(0, LEDGER_LIMITS.stepTitle),
      ...(step.milestone
        ? { milestone: step.milestone.slice(0, LEDGER_LIMITS.stepMilestone) }
        : {}),
      ...(step.state ? { state: step.state } : {}),
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
