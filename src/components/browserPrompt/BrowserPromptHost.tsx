import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStoreSelector } from '../../hooks/useStore';
import { useBrowserHost } from '../../lib/browserHost';
import { registerBrowserPromptUi, type BrowserPermissionPrompt } from '../../lib/browserPrompt';
import { toast } from '../../lib/toast';
import { BrowserPromptCard } from './BrowserPromptCard';
import { BrowserPromptDialog } from './BrowserPromptDialog';

/**
 * The app's one browser prompt UI, registered with main while mounted. A
 * protection change opens as a dialog; an agent's request as a card. One
 * presence owner shows one prompt at a time, the next after the last has gone.
 */
export function BrowserPromptHost() {
  const [prompt, setPrompt] = useState<BrowserPermissionPrompt | null>(null);
  const shownRequestId = useRef<string | null>(null);
  shownRequestId.current = prompt?.requestId ?? null;
  const paneAnchor = useBrowserHost().slot?.anchor ?? null;
  // Settings covers the pane, so a card shown then goes to the window corner.
  const settingsOpen = useStoreSelector((state) => state.settingsOpen);

  useEffect(
    () =>
      registerBrowserPromptUi(setPrompt, (requestId) => {
        setPrompt((current) => (current?.requestId === requestId ? null : current));
      }),
    [],
  );

  // An exiting prompt can still be clicked; only the prompt on screen answers.
  // Main may send its next prompt before this answer returns.
  const answer = useCallback((requestId: string, response: number) => {
    const api = window.droidControl;
    if (!api || shownRequestId.current !== requestId) return;
    shownRequestId.current = null;
    setPrompt((current) => (current?.requestId === requestId ? null : current));
    api.browserPermissionPromptResolve(requestId, response).then(
      (accepted) => {
        if (!accepted) toast.info('That browser request had already closed.');
      },
      () => {
        toast.error('DROIDEX could not send your answer. The request will be declined.');
      },
    );
  }, []);

  return (
    <AnimatePresence mode="wait">
      {prompt?.kind === 'warning' && (
        <BrowserPromptDialog key={prompt.requestId} prompt={prompt} onAnswer={answer} />
      )}
      {prompt && prompt.kind !== 'warning' && (
        <BrowserPromptCard
          key={prompt.requestId}
          prompt={prompt}
          paneAnchor={settingsOpen ? null : paneAnchor}
          onAnswer={answer}
        />
      )}
    </AnimatePresence>
  );
}
