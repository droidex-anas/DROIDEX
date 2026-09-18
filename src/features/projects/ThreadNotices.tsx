import { MessageBody } from '../../components/MessageBody';

/* DROIDEX writes two prompts of its own into project conversations: the brief a
   thread opens with, and a thread's report back to the chat that started it.
   Neither is something the user said, so neither wears the user's bubble —
   each reads as a quiet notice carrying only what the reader needs. */

// Written by ProjectWakeQueue's wakePrompt and ProjectService's brief; each
// pair must stay in step.
const REPORT_PREFIX = 'From DROIDEX, not the user: your project threads reported.';
const BRIEF_PREFIX = 'You are an independent DROIDEX thread:';
const BRIEF_TASK = '\nTask:\n';

export interface ThreadReport {
  lead: string;
  body: string;
}

export function threadReports(text: string | undefined): ThreadReport[] | null {
  if (!text?.startsWith(REPORT_PREFIX)) return null;
  const blocks = text.split('\n\n').slice(1);
  const reports = blocks.flatMap((block) => {
    const [head, ...rest] = block.split('\n');
    const lead = head.replace(/\s*\(thread [^)]+\):\s*$/, '');
    const body = rest.join('\n').trim();
    return lead && body ? [{ lead, body }] : [];
  });
  return reports.length > 0 ? reports : null;
}

/** The task a thread opened with, without the instructions DROIDEX added. */
export function threadBrief(text: string | undefined): string | null {
  if (!text?.startsWith(BRIEF_PREFIX)) return null;
  const marker = text.indexOf(BRIEF_TASK);
  const task = marker < 0 ? '' : text.slice(marker + BRIEF_TASK.length).trim();
  return task || null;
}

export function ThreadBriefNotice({ task }: { task: string }) {
  return (
    <div
      data-testid="thread-brief-notice"
      className="rounded-2xl border border-droid-border bg-droid-surface/35 px-4 py-3"
    >
      <p className="text-[12px] font-medium text-droid-text-muted">
        Task from the chat that started this thread
      </p>
      <div className="mt-1.5 text-[13px] leading-6 text-droid-text-secondary">
        <MessageBody text={task} live={false} autoPlayAppBlocks={false} cacheId="thread-brief" />
      </div>
    </div>
  );
}

export function ThreadReportNotice({ reports }: { reports: readonly ThreadReport[] }) {
  // A thread's report is the model's own prose: it reads with the same markdown
  // the chat gives every other reply.
  return (
    <div data-testid="thread-report-notice" className="flex flex-col gap-2">
      {reports.map((report) => (
        <div
          key={`${report.lead}:${report.body.slice(0, 40)}`}
          className="rounded-2xl border border-droid-border bg-droid-surface/35 px-4 py-3"
        >
          <p className="text-[12px] font-medium text-droid-text-muted">{report.lead}</p>
          <div className="mt-1.5 text-[13px] leading-6 text-droid-text-secondary">
            <MessageBody
              text={report.body}
              live={false}
              autoPlayAppBlocks={false}
              cacheId={`thread-report:${report.lead}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
