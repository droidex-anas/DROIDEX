// The kit's catalog in its Components section (palette brief, PR 3): a row for
// each entry with its module and note, and in a chat's pane a toggle that tags
// the entry, with its default options, in the chat. The open entry runs in the document's
// one catalog guest, built alone on a page from the saved version and showing
// the draft's token values. That guest is not one of the preview slots and is
// never captured, so the preview cap and the stills are untouched.

import { useContext, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Row, RowCaret, SectionHeader } from '../../../components/ui/Row';
import type { CatalogListing, KitPreviewTarget } from '../protocol';
import { TaggingChat } from '../componentPins';
import { useKitCatalog } from '../palette/useKitCatalog';
import { TagComponentButton } from '../TagComponentButton';
import { KitGuest, type KitPreviewing } from './KitPreviewTile';
import { useFitScale } from './useFitScale';

// The guest's page size: the column's measure, scaled down when the column is narrower.
const STAGE_WIDTH = 672;
const STAGE_HEIGHT = 240;

export function CatalogSection({
  entries,
  previewing,
}: {
  entries: readonly CatalogListing[];
  previewing: KitPreviewing;
}) {
  const [openName, setOpenName] = useState<string | null>(null);
  const listId = useId();
  const chatId = useContext(TaggingChat);
  const { kit } = previewing;
  // The name a tag sends is the shown version's, which a later version may have changed.
  const { catalog } = useKitCatalog(chatId === null ? undefined : kit);
  const kitName = catalog?.state === 'ready' ? catalog.kitName : undefined;
  // An entry searched away closes, as it does when search hides its whole section.
  if (openName !== null && !entries.some((entry) => entry.name === openName)) setOpenName(null);
  if (entries.length === 0) return null;
  return (
    <div className="-mx-3 flex flex-col">
      <SectionHeader id={`${listId}-label`} label="Catalog" className="pt-0" />
      {previewing.proposalId !== null && (
        <p id={`${listId}-saved`} className="px-3 pb-2 text-caption text-secondary">
          Catalog and previews show the saved version. The proposal may change them.
        </p>
      )}
      <ul
        aria-labelledby={`${listId}-label`}
        aria-describedby={previewing.proposalId === null ? undefined : `${listId}-saved`}
        className="flex flex-col"
      >
        {entries.map((entry, index) => {
          const isOpen = entry.name === openName;
          const stageId = `${listId}-stage-${String(index)}`;
          const noteId = `${listId}-note-${String(index)}`;
          const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !isOpen) return;
            event.preventDefault();
            setOpenName(null);
          };
          return (
            <li key={entry.name} className="group flex flex-col">
              <div className="flex items-center gap-1">
                <Row
                  label={<EntryLabel entry={entry} />}
                  trailing={<RowCaret open={isOpen} />}
                  active={isOpen}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? stageId : undefined}
                  aria-describedby={entry.note === null ? undefined : noteId}
                  className="min-w-0 flex-1"
                  onKeyDown={closeOnEscape}
                  onClick={() => {
                    setOpenName(isOpen ? null : entry.name);
                  }}
                />
                {chatId !== null && kitName !== undefined && (
                  <TagComponentButton
                    appSessionId={chatId}
                    pin={{ kit: { ...kit }, kitName, name: entry.name, props: [] }}
                    className="flex shrink-0"
                  />
                )}
              </div>
              {entry.note !== null && (
                <p id={noteId} className="px-3 pb-2 text-caption text-secondary">
                  {entry.note}
                </p>
              )}
              {isOpen && <EntryStage id={stageId} name={entry.name} previewing={previewing} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntryLabel({ entry }: { entry: CatalogListing }) {
  return (
    <>
      {entry.name}
      {entry.module !== null && <span className="text-muted"> {entry.module}</span>}
    </>
  );
}

/** The open entry on the kit's canvas colour, its name showing until the guest has painted. */
function EntryStage({
  id,
  name,
  previewing,
}: {
  id: string;
  name: string;
  previewing: KitPreviewing;
}) {
  const { kit, draftTokens, catalogSpecimen } = previewing;
  const fitRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(fitRef, STAGE_WIDTH);
  const target = useMemo(
    (): KitPreviewTarget => ({
      kind: 'catalog',
      ref: { id: kit.id, version: kit.version, mode: kit.mode },
      entry: name,
    }),
    [kit.id, kit.version, kit.mode, name],
  );
  return (
    <div
      id={id}
      className="mx-3 mb-2 mt-1 overflow-hidden rounded-lg"
      style={{ ...catalogSpecimen, background: 'var(--ds-canvas, var(--surface))' }}
    >
      <div
        className="relative mx-auto"
        style={{
          maxWidth: STAGE_WIDTH,
          aspectRatio: `${String(STAGE_WIDTH)} / ${String(STAGE_HEIGHT)}`,
        }}
      >
        <div ref={fitRef} className="absolute inset-0">
          <span
            role="img"
            aria-label={`${name} preview`}
            className="flex size-full items-center justify-center text-label text-muted"
          >
            {name}
          </span>
          {scale > 0 && (
            <KitGuest
              key={JSON.stringify([kit.id, kit.version, kit.mode, name])}
              kit={kit}
              target={target}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
              scale={scale}
              draftTokens={draftTokens}
              wantsCapture={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}
