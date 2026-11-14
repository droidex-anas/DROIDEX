// One Components entry opened in the tab: its name, file and note, the entry
// running live with the variants picked below it, and Add to board and Tag in
// chat for that pick. Escape or Back returns to the list as it was left; ⌘Enter
// adds and ⌘L tags from anywhere in it.

import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, MessageThread } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ADD_KEY_LABEL, isAddKey, isTagKey, TAG_KEY_LABEL } from '../boardKeys';
import { useComponentPins, type ComponentPin } from '../componentPins';
import { componentTag, TAG_TOOLTIPS, toggleComponentPin } from '../componentTagging';
import type { PropPick } from '../elementEditProtocol';
import { KitGuest } from '../KitGuest';
import { useKitCapture } from '../kitCaptures';
import type { CatalogListing, DesignSystemRef, KitPreviewTarget } from '../protocol';
import { MoreSegments, SegmentedControl, type Segment } from '../SegmentedControl';
import { useFitScale } from '../systemDocument/useFitScale';
import type { RowTagging } from './ComponentsPanel';
import type { ChosenProps } from './paletteRows';
import type { PalettePlace } from './useComponentInsert';

// The entry's page, scaled down to the tab's width.
const STAGE = { width: 400, height: 250 };
// A prop with more options than this shows the first few and a menu of the rest; more words would not fit the tab's width.
const MAX_SEGMENTS = 3;
const NO_TOKENS: Readonly<Record<string, string>> = {};

export function ComponentDetail({
  kit,
  entry,
  chosen,
  picks,
  place,
  tagging,
  onPick,
  onAdd,
  onBack,
}: {
  kit: DesignSystemRef;
  entry: CatalogListing;
  chosen: ChosenProps;
  /** What `chosen` writes; kept stable while it does not change, as a new pick is a new preview. */
  picks: PropPick[];
  place: PalettePlace;
  tagging: RowTagging;
  onPick: (prop: string, option: string) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const titleId = useId();
  const hintId = useId();
  // The keyboard comes along from the list, so Escape and the arrows keep working.
  useEffect(() => {
    section.current?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    } else if (isAddKey(event)) {
      event.preventDefault();
      if (place.canAdd && !event.repeat) onAdd();
    } else if (isTagKey(event) && tagging) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggleComponentPin(tagging.chatId, tagging.pinOf(entry, picks));
    }
  };
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 outline-none"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-1">
        <Tooltip label="Back  Esc" className="flex shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            aria-label="Back to components"
            onClick={onBack}
          />
        </Tooltip>
        <h3 id={titleId} className="min-w-0 truncate text-body-strong text-primary">
          {entry.name}
        </h3>
      </div>
      {entry.module !== null && (
        <p className="truncate pl-8 text-caption text-muted">{entry.module}</p>
      )}
      <EntryPreview kit={kit} entry={entry.name} picks={picks} />
      {entry.note !== null && <p className="mt-2 text-caption text-secondary">{entry.note}</p>}
      {entry.props.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {entry.props.map((prop) => (
            <VariantPicker
              key={prop.name}
              name={prop.name}
              options={prop.options}
              value={chosen[prop.name] ?? prop.default}
              onPick={(option) => {
                onPick(prop.name, option);
              }}
            />
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Tooltip label={`Add to board  ${ADD_KEY_LABEL}`} className="flex min-w-0 flex-1">
          <Button
            variant="primary"
            className="w-full"
            disabled={!place.canAdd}
            aria-describedby={hintId}
            onClick={onAdd}
          >
            Add to board
          </Button>
        </Tooltip>
        {tagging && <TagToggle chatId={tagging.chatId} pin={tagging.pinOf(entry, picks)} />}
      </div>
      <p id={hintId} aria-live="polite" className="mt-1.5 text-caption text-muted">
        {place.hint}
      </p>
    </section>
  );
}

/** The entry live on its kit page with the picks written on it; each new pick is a new build. */
function EntryPreview({
  kit,
  entry,
  picks,
}: {
  kit: DesignSystemRef;
  entry: string;
  picks: PropPick[];
}) {
  const fitRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(fitRef, STAGE.width);
  const { id, version, mode } = kit;
  const target = useMemo(
    (): KitPreviewTarget => ({ kind: 'catalog', ref: { id, version, mode }, entry, props: picks }),
    [id, version, mode, entry, picks],
  );
  const item = useMemo(() => ({ entry }), [entry]);
  // At its defaults the entry is what its row shows, so a row without a thumbnail gets this one.
  const thumbnail = useKitCapture(kit, item);
  return (
    <div
      className="relative mt-2 w-full overflow-hidden rounded-lg bg-elevated"
      style={{ aspectRatio: `${String(STAGE.width)} / ${String(STAGE.height)}` }}
    >
      {/* A click inside the guest would focus its own page, where Escape, ⌘Enter and ⌘L never reach this detail. */}
      <div ref={fitRef} className="pointer-events-none absolute inset-0">
        <span
          role="img"
          aria-label={`${entry} preview`}
          className="flex size-full items-center justify-center text-label text-muted"
        >
          {entry}
        </span>
        {scale > 0 && (
          <KitGuest
            key={JSON.stringify([id, version, mode, entry, picks])}
            kit={kit}
            target={target}
            width={STAGE.width}
            height={STAGE.height}
            scale={scale}
            draftTokens={NO_TOKENS}
            capture={thumbnail === null && picks.length === 0 ? item : null}
          />
        )}
      </div>
    </div>
  );
}

function VariantPicker({
  name,
  options,
  value,
  onPick,
}: {
  name: string;
  options: readonly string[];
  value: string;
  onPick: (option: string) => void;
}) {
  const segments: Segment<string>[] = options.map((option) => ({ value: option, label: option }));
  const shown = segments.length > MAX_SEGMENTS ? segments.slice(0, MAX_SEGMENTS - 1) : segments;
  const rest = segments.slice(shown.length);
  return (
    <SegmentedControl
      label={name}
      options={shown}
      value={shown.some((segment) => segment.value === value) ? value : ''}
      disabled={false}
      more={
        rest.length > 0 && (
          <MoreSegments
            label={`More ${name} options`}
            options={rest}
            value={value}
            disabled={false}
            onPick={onPick}
          />
        )
      }
      onPick={onPick}
    />
  );
}

/** Tag in chat with a word, as the detail has the room for one; the rows keep the icon. */
function TagToggle({ chatId, pin }: { chatId: string; pin: ComponentPin }) {
  const tag = componentTag(useComponentPins(chatId), pin);
  return (
    <Tooltip label={`${TAG_TOOLTIPS[tag]}  ${TAG_KEY_LABEL}`} className="flex shrink-0">
      <Button
        icon={tag === 'tagged' ? Check : MessageThread}
        aria-pressed={tag === 'tagged'}
        onClick={() => {
          toggleComponentPin(chatId, pin);
        }}
      >
        {tag === 'tagged' ? 'Tagged' : 'Tag in chat'}
      </Button>
    </Tooltip>
  );
}
