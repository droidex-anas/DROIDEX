/* DROIDEX writes two prompts of its own into project conversations: the brief a
   thread opens with, and a thread's report back to the chat that started it.
   Neither is something the user said, so neither wears the user's bubble; each
   reads as a quiet notice carrying only what the reader needs. */

// Written by ProjectWakeQueue's wakePrompt and threadStart's briefs; each pair
// must stay in step.
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

/* Each report opens with its own head line, "<thread> reported back (thread
   <id>):", and runs to the next one. Splitting on blank lines instead would
   lose every paragraph after the first and merge two threads into one card. */
const REPORT_HEAD = /^(.+?)\s*\(thread [^)]+\):\s*$/;

export function threadReports(text: string | undefined): ThreadReport[] | null {
  if (!text?.startsWith(REPORT_PREFIX)) return null;
  const reports: { lead: string; body: string[] }[] = [];
  for (const line of text.split('\n')) {
    const head = REPORT_HEAD.exec(line);
    if (head) reports.push({ lead: head[1], body: [] });
    else reports.at(-1)?.body.push(line);
  }
  const shown = reports
    .map((report) => ({ lead: report.lead, body: report.body.join('\n').trim() }))
    .filter((report) => report.body);
  return shown.length > 0 ? shown : null;
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
