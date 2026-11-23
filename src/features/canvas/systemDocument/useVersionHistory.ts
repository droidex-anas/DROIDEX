import { useEffect, useRef, useState } from 'react';
import type { DesignSystemVersionContent, DesignSystemVersionEntry } from '@droidex/protocol';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import { changeSummary } from './documentSections';

type VersionList =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'listed'; versions: DesignSystemVersionEntry[] };

// Versions never change, so what each changed is read once per app session.
const summaries = new Map<string, string>();

export function useVersionHistory(id: string) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VersionList>({ status: 'loading' });
  const [summarized, setSummarized] = useState<ReadonlyMap<number, string>>(new Map());
  const requestRef = useRef(0);
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [id],
  );

  const close = () => {
    requestRef.current += 1;
    setOpen(false);
  };

  const openMenu = () => {
    setOpen(true);
    setList({ status: 'loading' });
    setSummarized(new Map());
    requestRef.current += 1;
    const request = requestRef.current;
    const isLive = () => request === requestRef.current;
    canvasClient.designSystems.versions(id).then(
      (versions) => {
        if (!isLive()) return;
        setList({ status: 'listed', versions });
        const onSummary = (version: number, summary: string) => {
          setSummarized((known) => new Map(known).set(version, summary));
        };
        // A version that cannot be read leaves its row without the line.
        summarize(id, versions, isLive, onSummary).catch((error: unknown) => {
          if (isLive())
            console.error("A design system version's changes could not be read:", error);
        });
      },
      (error: unknown) => {
        if (isLive()) setList({ status: 'failed', message: canvasMessage(error) });
      },
    );
  };

  return { open, list, summarized, close, openMenu };
}

/** Reads newest first, carrying the previous document forward until the menu closes. */
async function summarize(
  id: string,
  versions: DesignSystemVersionEntry[],
  isLive: () => boolean,
  onSummary: (version: number, summary: string) => void,
): Promise<void> {
  const read = (version: number) => canvasClient.designSystems.readVersionContent({ id, version });
  let carried: DesignSystemVersionContent | null = null;
  for (const [index, { version }] of versions.entries()) {
    if (!isLive()) return;
    const key = `${id}@${String(version)}`;
    const known = summaries.get(key);
    if (known !== undefined) {
      onSummary(version, known);
      carried = null;
      continue;
    }
    const older = versions.at(index + 1)?.version;
    const current = carried ?? (await read(version));
    if (!isLive()) return;
    const previous = older === undefined ? null : await read(older);
    if (!isLive()) return;
    const summary = previous ? changeSummary(previous, current) : 'Created';
    summaries.set(key, summary);
    onSummary(version, summary);
    carried = previous;
  }
}
