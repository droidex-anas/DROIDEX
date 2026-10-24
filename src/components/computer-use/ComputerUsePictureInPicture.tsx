import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { useBrowserHost } from '../../lib/browserHost';
import { visibleSessionTarget } from '../../lib/childSessions';
import { sessionIsLive } from '../../lib/sessions';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import type { TranscriptEvent } from '../../types/bridge';
import type { PreviewSource } from './ComputerUsePreviewWindow';
import { ImageLightbox } from '../media/ImageLightbox';
import { computerUseActivity } from './computerUseActivity';

const NO_EVENTS: TranscriptEvent[] = [];
const PreviewWindow = lazy(() => import('./ComputerUsePreviewWindow'));

/** One preview for the focused conversation, kept across steps until its turn settles. */
export function ComputerUsePictureInPicture({ hidden }: { hidden: boolean }) {
  const [inspectedImage, setInspectedImage] = useState<string | null>(null);
  const current = useStoreSelector((state) => {
    const appSessionId = state.activeAppSessionId;
    const session = appSessionId ? state.sessions[appSessionId] : undefined;
    const panel = utilityPanelForSession(state.utilityPanels, session?.appSessionId);
    const tab = panel.open ? panel.tabs.find((item) => item.id === panel.activeTabId) : undefined;
    const selection =
      session && tab?.tool === 'agents' && tab.agentId && tab.agentId !== 'primary'
        ? { parentAppSessionId: session.appSessionId, childSessionId: tab.agentId }
        : state.selectedChild;
    const target = visibleSessionTarget(
      appSessionId ?? undefined,
      selection,
      state.childSessions,
      state.childAccess,
    );
    const childSessionId = target.kind === 'child' ? target.childSessionId : null;
    return {
      appSessionId: session?.appSessionId,
      childSessionId,
      events: session ? (state.transcripts[session.appSessionId] ?? NO_EVENTS) : NO_EVENTS,
      live:
        target.kind === 'child'
          ? target.child.status === 'running' && !target.child.queued
          : session !== undefined && sessionIsLive(session),
      browser: session ? state.browsers[session.appSessionId] : undefined,
    };
  }, shallowEqual);
  const activity = useMemo(
    () => computerUseActivity(current.events, current.childSessionId),
    [current.events, current.childSessionId],
  );
  const browserHost = useBrowserHost();
  let source: PreviewSource | null = null;
  if (!hidden && current.live && activity) {
    if (activity.kind === 'computer') {
      source = { kind: 'computer', image: activity.image, title: 'Computer use' };
    } else if (
      current.browser &&
      browserHost.slot?.browserSessionId !== current.browser.browserSessionId
    ) {
      source = {
        kind: 'browser',
        browserSessionId: current.browser.browserSessionId,
        title: current.browser.title?.length ? current.browser.title : 'Browser',
      };
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        <AnimatePresence>
          {current.appSessionId && source && activity && (
            <PreviewWindow
              key={`${current.appSessionId}:${current.childSessionId ?? 'primary'}:${activity.turnId}:${source.kind}`}
              source={source}
              onInspect={setInspectedImage}
            />
          )}
        </AnimatePresence>
      </Suspense>
      {inspectedImage && (
        <ImageLightbox
          src={inspectedImage}
          label="Computer use"
          onClose={() => {
            setInspectedImage(null);
          }}
        />
      )}
    </>
  );
}
