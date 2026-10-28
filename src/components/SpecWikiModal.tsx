import { useCallback } from 'react';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { SpecModal } from './SpecModal';

// Single full-screen spec/plan reader, driven by store state so it can be
// opened from the inline chat card, the approval bar, or the right panel.
export default function SpecWikiModal() {
  const dispatch = useStoreDispatch();
  const spec = useStoreSelector((state) => {
    const appSessionId = state.specWikiAppSessionId;
    return appSessionId ? state.sessionSpecs[appSessionId] : undefined;
  });
  // Stable, so SpecModal's focus and Escape layer are set up once per opening.
  const close = useCallback(() => {
    dispatch({ type: 'SPEC_CLOSE_WIKI' });
  }, [dispatch]);

  return (
    <SpecModal open={!!spec} content={spec?.content ?? ''} title={spec?.title} onClose={close} />
  );
}
