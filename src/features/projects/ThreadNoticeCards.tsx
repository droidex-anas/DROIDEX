import { MessageSquareText } from '@droidex/icons';
import { MessageBody } from '../../components/MessageBody';
import { ModelIcon } from '../../components/ModelIcon';
import { useStoreSelector } from '../../hooks/useStore';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../providers/providerIdentity';
import type { ThreadBrief, ThreadReport, ThreadSender } from './threadNotices';

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

/* A project reads like a group chat: the user's bubbles on the right, the
   main chat's replies as its own prose, and each thread as a member with its
   harness's mark for a face. A message from a chat outside the project stays
   a notice. */
export function ThreadReportNotice({ reports }: { reports: readonly ThreadReport[] }) {
  return (
    <div data-testid="thread-report-notice" className="flex flex-col gap-3">
      {reports.map((report) =>
        report.from ? (
          <ThreadMessage
            key={`${report.from.threadId}:${report.body.slice(0, 40)}`}
            from={report.from}
            text={report.body}
          />
        ) : (
          <NoticeCard
            key={`${report.lead}:${report.body.slice(0, 40)}`}
            lead={report.lead}
            text={report.body}
            cacheId={`thread-report:${report.lead}`}
          />
        ),
      )}
    </div>
  );
}

function ThreadMessage({ from, text }: { from: ThreadSender; text: string }) {
  const provider = useStoreSelector((state) =>
    Object.hasOwn(state.sessions, from.threadId)
      ? state.sessions[from.threadId].provider
      : undefined,
  );
  const asks = from.action === 'needs a decision';
  return (
    <div data-testid="thread-message" className="flex items-end gap-2.5">
      <span
        role="img"
        aria-label={provider ? `${PROVIDER_LABELS[provider]} thread` : 'Thread'}
        className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-droid-border bg-droid-surface"
      >
        {provider ? (
          <ModelIcon provider={PROVIDER_MARKS[provider]} size={14} />
        ) : (
          <MessageSquareText className="h-3.5 w-3.5 text-droid-text-muted" />
        )}
      </span>
      <div className="min-w-0 max-w-[88%]">
        <p className="flex min-w-0 items-baseline gap-1.5 pb-1 pl-1 text-[12px] leading-4">
          <span className="truncate font-medium text-droid-text-secondary">{from.name}</span>
          <span className={`shrink-0 ${asks ? 'text-droid-orange' : 'text-droid-text-muted'}`}>
            {from.action}
          </span>
        </p>
        <div className="rounded-2xl rounded-bl-md bg-droid-elevated/70 px-3.5 py-2.5 text-[13px] leading-6 text-droid-text-secondary">
          <MessageBody text={text} live={false} cacheId={`thread-message:${from.threadId}`} />
        </div>
      </div>
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
        <MessageBody text={text} live={false} cacheId={cacheId} />
      </div>
    </div>
  );
}
