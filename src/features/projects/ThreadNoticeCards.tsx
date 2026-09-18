import { MessageBody } from '../../components/MessageBody';
import type { ThreadReport } from './threadNotices';

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
