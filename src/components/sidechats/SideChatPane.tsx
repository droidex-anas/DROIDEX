import type { ReactNode } from 'react';
import { X } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { currentSideChat, shownSideChat, sideChatPanel } from '../../lib/sideChats';
import { SideChatDetail } from './SideChatDetail';
import { SideChatHeader, SideChatHeaderButton } from './SideChatHeader';
import { SideChatHome } from './SideChatHome';
import { useCloseSideChat } from './useCloseSideChat';

/* The side chat of one session, wherever it is placed: the composer that
   starts it, a side chat starting, or the side chat itself. `controls` are the
   placement's own buttons (pop out, expand and minimize when docked; minimize
   and dock when floating), shown at the end of every header before Close. */

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
  const closeSideChat = useCloseSideChat();
  const { source, view, shown, latest } = useStoreSelector((current) => {
    const { view } = sideChatPanel(current.sideChats, sourceAppSessionId);
    return {
      source: Object.hasOwn(current.sessions, sourceAppSessionId)
        ? current.sessions[sourceAppSessionId]
        : undefined,
      view,
      shown: shownSideChat(current.sessions, current.chatMetadata, sourceAppSessionId, view),
      latest: currentSideChat(current.sessions, current.chatMetadata, sourceAppSessionId),
    };
  }, shallowEqual);
  if (!source) return null;

  const showCurrent = () => {
    dispatch({ type: 'SHOW_SIDE_CHAT', sourceAppSessionId, view: { kind: 'current' } });
  };

  const headerControls = (
    <>
      {controls}
      {/* A starting side chat still arrives after a close, so it can only be minimized. */}
      {view.kind !== 'starting' && (
        <SideChatHeaderButton
          label="Close side chat"
          onClick={() => {
            closeSideChat.requestClose(sourceAppSessionId);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </SideChatHeaderButton>
      )}
      {closeSideChat.dialog}
    </>
  );

  if (shown) {
    return (
      <SideChatDetail
        key={shown.appSessionId}
        sourceAppSessionId={sourceAppSessionId}
        session={shown}
        wide={wide}
        controls={headerControls}
        {...(shown !== latest ? { onBack: showCurrent } : {})}
      />
    );
  }

  if (view.kind === 'starting') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SideChatHeader controls={headerControls}>
          <span className="shimmer-text min-w-0 flex-1 truncate px-1 text-[13px] font-medium">
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
      <SideChatHeader controls={headerControls}>
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium text-droid-text">
          Side chat
        </span>
      </SideChatHeader>
      <div className={`flex min-h-0 flex-1 flex-col ${wide ? 'mx-auto w-full max-w-3xl' : ''}`}>
        <SideChatHome source={source} draft={view.kind === 'new' ? view.prompt : ''} />
      </div>
    </div>
  );
}
