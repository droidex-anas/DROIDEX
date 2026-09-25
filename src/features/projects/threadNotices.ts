/* DROIDEX writes prompts of its own into conversations it starts: the brief a
   lead, a thread or a chat another chat started opens with, and a thread's
   report back to the chat that started it. None is something the user said,
   so none wears the user's bubble; each reads as a quiet notice carrying only
   what the reader needs. */

// Written by ProjectWakeQueue's wakePrompt, threadStart's briefs and
// SpawnedChats' opening prompt; each pair must stay in step.
const REPORT_PREFIX = 'From DROIDEX, not the user: your project threads reported.';
const THREAD_BRIEF_PREFIX = 'You are an independent DROIDEX thread:';
const LEAD_BRIEF_PREFIX = 'You lead a DROIDEX project.';
const CHAT_BRIEF_PREFIX = 'Another DROIDEX chat started this conversation';
const STARTED_BY = /^Started by: (.+)$/m;
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
  const marker = text.indexOf(BRIEF_TASK);
  if (marker < 0) return null;
  const lead = briefLead(text.slice(0, marker));
  const task = text.slice(marker + BRIEF_TASK.length).trim();
  return lead && task ? { lead, task } : null;
}

function briefLead(head: string): string {
  if (head.startsWith(LEAD_BRIEF_PREFIX)) return 'The goal for this project';
  if (head.startsWith(THREAD_BRIEF_PREFIX)) return 'Task from the chat that started this thread';
  if (!head.startsWith(CHAT_BRIEF_PREFIX)) return '';
  const owner = STARTED_BY.exec(head)?.[1].trim();
  return owner ? `Task from ${owner}` : 'Task from another chat';
}
