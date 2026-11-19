import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { TranscriptEvent } from '@droidex/protocol';
import type { Action, AppState } from '../hooks/useStore';
import { readFile } from '../lib/desktop';
import type { TranscriptMutation } from '../lib/transcriptMutation';
import { createTranscriptSpecPathProjector } from '../lib/transcriptSpecPath';

export function useChatSpec({
  activeAppSessionId,
  isSpecMode,
  allTranscript,
  transcriptMutation,
  capturedPlan,
  storedSpec,
  dispatch,
}: {
  activeAppSessionId: string | undefined;
  isSpecMode: boolean;
  allTranscript: TranscriptEvent[];
  transcriptMutation: TranscriptMutation | undefined;
  capturedPlan: string | undefined;
  storedSpec: AppState['sessionSpecs'][string] | undefined;
  dispatch: Dispatch<Action>;
}) {
  const specPathProjectorRef = useRef<ReturnType<typeof createTranscriptSpecPathProjector> | null>(
    null,
  );
  specPathProjectorRef.current ??= createTranscriptSpecPathProjector();

  // The spec stays available after exiting spec mode: keep detecting/loading it
  // whenever this session ever produced one (live mode, captured plan, or a
  // previously stored spec).
  const hadSpec = isSpecMode || !!capturedPlan || !!storedSpec;

  // The real deliverable in spec mode is a markdown file written to disk
  // (e.g. ~/.factory/specs/<date>-<slug>.md). Detect that path anywhere in the
  // transcript (assistant prose or the write tool's args) and load the file.
  const specPath = specPathProjectorRef.current({
    conversationKey: activeAppSessionId ?? 'none',
    source: allTranscript,
    mutation: transcriptMutation,
    enabled: hadSpec,
  });

  const [fileSpec, setFileSpec] = useState<{ path: string; content: string } | null>(null);
  // Re-read on `capturedPlan` changes too: a revised spec rewrites the same file
  // path, so the path alone wouldn't trigger a reload and the card would go stale.
  useEffect(() => {
    if (!specPath) return;
    let cancelled = false;
    void readFile(specPath).then((content) => {
      if (!cancelled && content) setFileSpec({ path: specPath, content });
    });
    return () => {
      cancelled = true;
    };
  }, [specPath, capturedPlan]);

  const hasFileSpec = !!fileSpec && fileSpec.path === specPath;

  // Spec content is ONLY content explicitly produced/stored as spec (#14): the
  // saved spec file or the plan submitted via ExitSpecMode. Normal assistant
  // prose is never reclassified as spec, so pressing Spec can't capture chat.
  const specContent = useMemo(() => {
    if (!hadSpec) return '';
    // 1) The saved spec file (full doc with diagrams/tables) is the best source.
    if (hasFileSpec) return fileSpec.content;
    // 2) The plan the agent submitted via ExitSpecMode.
    if (capturedPlan) return capturedPlan;
    // 3) Previously persisted spec (e.g. after switching sessions and back).
    if (storedSpec?.content) return storedSpec.content;
    return '';
  }, [hadSpec, hasFileSpec, fileSpec, capturedPlan, storedSpec]);

  // Persist the best spec we have so the card, wiki reader, and right-panel
  // button survive exiting spec mode and switching between sessions.
  useEffect(() => {
    if (!activeAppSessionId || !specContent) return;
    const title = /^#{1,3}\s+(.+)$/m.exec(specContent)?.[1]?.trim() ?? 'Specification';
    // Preserve the existing file path when the current source is not file-backed
    // (e.g. a captured plan), so the store never loses a known path on refresh.
    const path = hasFileSpec ? fileSpec.path : storedSpec?.path;
    dispatch({
      type: 'SPEC_SET',
      appSessionId: activeAppSessionId,
      ...(path !== undefined ? { path } : {}),
      title,
      content: specContent,
    });
  }, [activeAppSessionId, specContent, hasFileSpec, fileSpec, storedSpec?.path, dispatch]);

  return specContent;
}
