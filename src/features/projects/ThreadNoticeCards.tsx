import { MessageBody } from '../../components/MessageBody';
import type { ThreadBrief, ThreadReport } from './threadNotices';

export function ThreadBriefNotice({ brief }: { brief: ThreadBrief }) {
  return (
    <NoticeCard
      testId="thread-brief-notice"
      lead={brief.lead}
      text={brief.task}
      cacheId="thread-brief"
    />
  );
}

export function ThreadReportNotice({ reports }: { reports: readonly ThreadReport[] }) {
  return (
    <div data-testid="thread-report-notice" className="flex flex-col gap-2">
      {reports.map((report) => (
        <NoticeCard
          key={`${report.lead}:${report.body.slice(0, 40)}`}
          lead={report.lead}
          text={report.body}
          cacheId={`thread-report:${report.lead}`}
        />
      ))}
    </div>
  );
}

// A brief or a report is the model's own prose: it reads with the same markdown
// the chat gives every other reply.
function NoticeCard({
  lead,
  text,
  cacheId,
  testId,
}: {
  lead: string;
  text: string;
  cacheId: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border border-droid-border bg-droid-surface/35 px-4 py-3"
    >
      <p className="text-[12px] font-medium text-droid-text-muted">{lead}</p>
      <div className="mt-1.5 text-[13px] leading-6 text-droid-text-secondary">
        <MessageBody text={text} live={false} autoPlayAppBlocks={false} cacheId={cacheId} />
      </div>
    </div>
  );
}
