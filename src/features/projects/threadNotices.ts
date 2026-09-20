/* DROIDEX writes two prompts of its own into project conversations: the brief a
   thread opens with, and a thread's report back to the chat that started it.
   Neither is something the user said, so neither wears the user's bubble — each
   reads as a quiet notice carrying only what the reader needs. */

// Written by ProjectWakeQueue's wakePrompt and ProjectService's brief; each
// pair must stay in step.
const REPORT_PREFIX = 'From DROIDEX, not the user: your project threads reported.';
const THREAD_BRIEF_PREFIX = 'You are an independent DROIDEX thread:';
const LEAD_BRIEF_PREFIX = 'You lead a DROIDEX project.';
const BRIEF_TASK = '\nTask:\n';

export interface ThreadBrief {
  /** Who set this conversation going, in the words the reader needs. */
  lead: string;
  task: string;
}

export interface ThreadReport {
  lead: string;
  body: string;
}

export function threadReports(text: string | undefined): ThreadReport[] | null {
  if (!text?.startsWith(REPORT_PREFIX)) return null;
  const reports = text
    .split('\n\n')
    .slice(1)
    .flatMap((block) => {
      const [head, ...rest] = block.split('\n');
      const lead = head.replace(/\s*\(thread [^)]+\):\s*$/, '');
      const body = rest.join('\n').trim();
      return lead && body ? [{ lead, body }] : [];
    });
  return reports.length > 0 ? reports : null;
}

/**
 * What a project conversation opened with, without the instructions DROIDEX
 * added. A lead opens with the user's own goal; a thread opens with the task
 * its lead handed down, and the two must never read the same.
 */
export function threadBrief(text: string | undefined): ThreadBrief | null {
  if (text === undefined) return null;
  const lead = text.startsWith(LEAD_BRIEF_PREFIX)
    ? 'The goal for this project'
    : text.startsWith(THREAD_BRIEF_PREFIX)
      ? 'Task from the chat that started this thread'
      : '';
  if (!lead) return null;
  const marker = text.indexOf(BRIEF_TASK);
  const task = marker < 0 ? '' : text.slice(marker + BRIEF_TASK.length).trim();
  return task ? { lead, task } : null;
}
