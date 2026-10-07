import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useStoreSelector } from '../../hooks/useStore';
import { useBrowserHost } from '../../lib/browserHost';
import {
  answerBrowserPrompt,
  registerBrowserPromptUi,
  type BrowserPermissionPrompt,
} from '../../lib/browserPrompt';
import { toast } from '../../lib/toast';
import { BrowserPromptCard } from './BrowserPromptCard';
import { BrowserPromptDialog } from './BrowserPromptDialog';

/**
 * The app's one browser prompt UI, registered with main while mounted. A
 * protection change opens as a dialog; an agent's request as a card.
 */
export function BrowserPromptHost() {
  const [prompt, setPrompt] = useState<BrowserPermissionPrompt | null>(null);
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

  // Main may send its next prompt before this answer returns, so only the
  // answered prompt is cleared.
  const answer = useCallback((requestId: string, response: number) => {
    setPrompt((current) => (current?.requestId === requestId ? null : current));
    answerBrowserPrompt(requestId, response).then(
      (accepted) => {
        if (!accepted) toast.info('That browser request had already closed.');
      },
      () => {
        toast.error('DROIDEX could not send your answer. The request will be declined.');
      },
    );
  }, []);

  const isDialog = prompt?.kind === 'warning';
  return (
    <>
      <AnimatePresence>
        {prompt && isDialog && (
          <BrowserPromptDialog key={prompt.requestId} prompt={prompt} onAnswer={answer} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {prompt && !isDialog && (
          <BrowserPromptCard
            key={prompt.requestId}
            prompt={prompt}
            paneAnchor={settingsOpen ? null : paneAnchor}
            onAnswer={answer}
          />
        )}
      </AnimatePresence>
    </>
  );
}
