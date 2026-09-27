import { useState, type ReactNode } from 'react';
import { X } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { interruptSession } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import { currentSideChat, shownSideChat, sideChatPanel } from '../../lib/sideChats';
import { SideChatCloseDialog } from './SideChatCloseDialog';
import { SideChatDetail } from './SideChatDetail';
import { SideChatHeader, SideChatHeaderButton } from './SideChatHeader';
import { SideChatHome } from './SideChatHome';

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
  const [confirmingClose, setConfirmingClose] = useState(false);
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

  // With nothing to lose, Close only takes the pane off screen.
  const closeSideChat = () => {
    if (!shown) {
      dispatch({ type: 'CLOSE_SIDE_CHAT', sourceAppSessionId });
      return;
    }
    if (sessionIsLive(shown)) interruptSession(shown.appSessionId);
    dispatch({ type: 'CLOSE_SIDE_CHAT', sourceAppSessionId, appSessionId: shown.appSessionId });
  };

  const headerControls = (
    <>
      {controls}
      <SideChatHeaderButton
        label="Close side chat"
        onClick={() => {
          if (shown) setConfirmingClose(true);
          else closeSideChat();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </SideChatHeaderButton>
      {confirmingClose && (
        <SideChatCloseDialog
          onCancel={() => {
            setConfirmingClose(false);
          }}
          onConfirm={() => {
            setConfirmingClose(false);
            closeSideChat();
          }}
        />
      )}
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
