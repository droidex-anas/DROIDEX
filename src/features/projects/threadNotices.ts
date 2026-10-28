/* DROIDEX writes prompts of its own into conversations: the brief a lead, a
   thread or a chat another chat started opens with, a thread's report back to
   the chat that started it, and a message one chat sends another. None is
   something the user said, so none wears the user's bubble; each reads as a
   quiet notice carrying only what the reader needs. */

// Written by projectMessages' wakePrompt, threadStart's briefs, SpawnedChats'
// opening prompt and SidebarSessions' messagePrompt; each pair must stay in step.
const REPORT_PREFIXES = [
  'Project update — lead action required',
  'From DROIDEX, not the user: your project threads reported.',
];
const INSTRUCTION_PREFIX = 'Instructions from your project lead';
const MESSAGE_PREFIX = 'From DROIDEX, not the user: another chat sent you a message.';
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
  /** Set on a project's own messages, which read as that thread speaking. */
  from?: ThreadSender;
}

export interface ThreadSender {
  threadId: string;
  name: string;
  /** What it did, in wakePrompt's words: reported back, needs a decision, sent a message. */
  action: string;
}

/* Each report opens with its own head line, "<thread> reported back (thread
   <id>):" or "Message from <chat> (chat <id>):", and runs to the next one.
   Splitting on blank lines instead would lose every paragraph after the first
   and merge two threads into one card. */
const REPORT_HEAD = /^(.+?)\s*\((thread|chat) ([^),]+)[^)]*\):\s*$/;
// projectMessages' VERB, which ends a project message's head.
const ACTIONS = [
  'reported back',
  'needs a decision',
  'needs approval',
  'team idle',
  'sent a message',
  'gave instructions',
];

/** Whether a prompt is the project's own threads speaking. */
export function isThreadReport(text: string | undefined): boolean {
  return (
    REPORT_PREFIXES.some((prefix) => text?.startsWith(prefix)) ||
    text?.startsWith(INSTRUCTION_PREFIX) === true
  );
}

export function threadReports(text: string | undefined): ThreadReport[] | null {
  if (!text || (!isThreadReport(text) && !text.startsWith(MESSAGE_PREFIX))) return null;
  const project = isThreadReport(text);
  const reports: { lead: string; threadId: string; body: string[] }[] = [];
  for (const line of text.split('\n')) {
    const head = REPORT_HEAD.exec(line);
    if (head) reports.push({ lead: head[1], threadId: head[3], body: [] });
    else reports.at(-1)?.body.push(line);
  }
  const shown = reports
    .map(({ lead, threadId, body }) => {
      const from = project ? sender(lead, threadId) : undefined;
      return { lead, body: body.join('\n').trim(), ...(from ? { from } : {}) };
    })
    .filter((report) => report.body);
  return shown.length > 0 ? shown : null;
}

function sender(lead: string, threadId: string): ThreadSender | undefined {
  const action = ACTIONS.find((candidate) => lead.endsWith(` ${candidate}`));
  if (!action) return undefined;
  return { threadId, name: lead.slice(0, -action.length - 1), action };
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
