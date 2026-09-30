import { Suspense } from 'react';
import { threadReports } from '../../features/projects/threadNotices';
import { useStoreSelector } from '../../hooks/useStore';
import { sendSteerNow } from '../../lib/commands';
import { ThreadReportNotice } from '../chat';
import { PromptActions } from './ResponseActions';
import { UserBubble } from './UserBubble';

// The steers the sidecar lists as not taken in by the model yet, below the
// transcript in the order they were sent. Each can be sent now. The user's own
// is their bubble; a message from another chat is the notice it becomes once
// the model takes it in, by the same rule the transcript row uses.
export function PendingSteers({ appSessionId }: { appSessionId: string }) {
  const steers = useStoreSelector((state) =>
    Object.hasOwn(state.sessions, appSessionId)
      ? state.sessions[appSessionId].pendingSteers
      : undefined,
  );
  if (!steers) return null;
  return steers.map((steer) => {
    const sendNow = () => {
      sendSteerNow(appSessionId, steer.id);
    };
    const reports = threadReports(steer.text);
    return (
      <div key={steer.id} className="prompt-enter mx-auto min-w-0 max-w-2xl pb-2 pt-2">
        {reports ? (
          <div className="group/msg relative">
            <Suspense fallback={null}>
              <ThreadReportNotice reports={reports} />
            </Suspense>
            <PromptActions
              text={reports.map((report) => report.body).join('\n\n')}
              onSendNow={sendNow}
            />
          </div>
        ) : (
          <UserBubble event={{ text: steer.text }} onSendNow={sendNow} />
        )}
      </div>
    );
  });
}
