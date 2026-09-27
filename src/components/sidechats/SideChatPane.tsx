import type { ReactNode } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { sideChatPanel } from '../../lib/sideChats';
import { SideChatDetail } from './SideChatDetail';
import { SideChatBackButton, SideChatHeader } from './SideChatHeader';
import { SideChatHome } from './SideChatHome';

/* The side chats of one session, wherever they are placed: the list with its
   composer, a side chat starting, or one side chat open. `controls` are the
   placement's own buttons (pop out and expand when docked; minimize, dock and
   close when floating), shown at the end of every header. Every view but the
   list leads back to it, where the next side chat starts. */

export function SideChatPane({
  sourceAppSessionId,
  wide,
  controls,
}: {
  sourceAppSessionId: string;
  wide: boolean;
  controls: ReactNode;
}) {
  const dispatch = useStoreDispatch();
  const { source, view, openSession } = useStoreSelector((current) => {
    const { view } = sideChatPanel(current.sideChats, sourceAppSessionId);
    return {
      source: Object.hasOwn(current.sessions, sourceAppSessionId)
        ? current.sessions[sourceAppSessionId]
        : undefined,
      view,
      openSession:
        view.kind === 'chat' && Object.hasOwn(current.sessions, view.appSessionId)
          ? current.sessions[view.appSessionId]
          : undefined,
    };
  }, shallowEqual);
  if (!source) return null;

  const showList = () => {
    dispatch({ type: 'SHOW_SIDE_CHAT', sourceAppSessionId, view: { kind: 'list' } });
  };

  if (openSession) {
    return (
      <SideChatDetail
        key={openSession.appSessionId}
        sourceAppSessionId={sourceAppSessionId}
        session={openSession}
        wide={wide}
        controls={controls}
        onBack={showList}
      />
    );
  }

  if (view.kind === 'starting') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SideChatHeader controls={controls}>
          <SideChatBackButton onClick={showList} />
          <span className="shimmer-text min-w-0 flex-1 truncate text-[13px] font-medium">
            Starting side chat
          </span>
        </SideChatHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-droid-elevated px-3.5 py-2 text-[13px] leading-5 text-droid-text">
            {view.prompt}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SideChatHeader controls={controls}>
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium text-droid-text">
          Side chats
        </span>
      </SideChatHeader>
      <div className={`flex min-h-0 flex-1 flex-col ${wide ? 'mx-auto w-full max-w-3xl' : ''}`}>
        <SideChatHome source={source} draft={view.kind === 'new' ? view.prompt : ''} />
      </div>
    </div>
  );
}
