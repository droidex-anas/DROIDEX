// One section of the document (spec §5, §6): a heading with its count and
// menu, then its notes, token groups, previews and assets in reading order.

import { useContext, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash, Upload } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import type {
  DocumentAsset,
  DocumentSection,
  DocumentToken,
  TokenKind,
} from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { AddRow } from './AddRow';
import { AssetGrid, ImageDropCue } from './AssetsSection';
import type { DraftChange } from './documentDraft';
import type { DocumentItem, DraftMark } from './documentSections';
import { PreviewItem } from './DocumentPreview';
import { InlineField, type InlineFieldHandle } from './InlineField';
import { useKitImageImport, type ImportedImage } from './kitImageImport';
import type { KitPreviewing } from './KitPreviewTile';
import { NoteCard } from './NoteCard';
import { TokenTable } from './TokenTable';
import { TypeSpecimen, type TypeSpecimenSize } from './TypeSpecimen';
import { IN_ADDED_SECTION, ProposalMarks } from './proposalReview';
import { AddedLabel, UndoRemove, UnsavedMark } from './UnsavedMark';

const MAX_TITLE_LENGTH = 120;

/** What an editable section needs beyond what it shows. */
export interface SectionEditing {
  /** The section's item ids as the draft holds them, which bound where each can move. */
  itemIds: string[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (change: DraftChange) => void;
  /** Adds an item at the section's end, or before the item `before` names. */
  onAdd: (kind: 'note' | 'group', before?: string) => void;
  /** Adds imported images to the section and returns how many did not fit; null where it takes none. */
  onAddImages: ((images: ImportedImage[]) => number) | null;
}

export function SectionBlock({
  section,
  count,
  kitId,
  mode,
  specimens,
  marks,
  baseTokens,
  tokenNames,
  noteLabels,
  previewTitles,
  assetNames,
  previewing,
  typeSpecimen,
  justAdded,
  editing,
}: {
  section: DocumentSection;
  count: number;
  kitId: string;
  mode: PreviewMode;
  specimens: Record<PreviewMode, CSSProperties>;
  marks: ReadonlyMap<string, DraftMark>;
  baseTokens: ReadonlyMap<string, DocumentToken>;
  tokenNames: ReadonlySet<string>;
  noteLabels: ReadonlySet<string>;
  previewTitles: ReadonlySet<string>;
  assetNames: ReadonlySet<string>;
  previewing: KitPreviewing;
  /** The saved version's type specimen, which follows this section's groups. */
  typeSpecimen: TypeSpecimenSize | null;
  /** The item or section the user just added, which opens for editing. */
  justAdded: string | null;
  editing: SectionEditing | null;
}) {
  const titleRef = useRef<InlineFieldHandle>(null);
  const proposal = useContext(ProposalMarks);
  const mark = marks.get(section.id);
  const isRemoved = mark === 'removed';
  const onChange = editing?.onChange ?? null;
  const tokenKind = tokenKindOf(section);
  const holdsTokens = tokenKind !== null;
  const imports = useKitImageImport(editing?.onAddImages ?? null);

  const itemActions = (id: string): MenuAction[] => {
    if (!editing) return [];
    const at = editing.itemIds.indexOf(id);
    return [
      {
        label: 'Move up',
        icon: ArrowUp,
        disabled: at <= 0,
        run: () => {
          editing.onChange({ kind: 'move', key: id, by: -1 });
        },
      },
      {
        label: 'Move down',
        icon: ArrowDown,
        disabled: at < 0 || at === editing.itemIds.length - 1,
        run: () => {
          editing.onChange({ kind: 'move', key: id, by: 1 });
        },
      },
      {
        label: 'Remove',
        icon: Trash,
        danger: true,
        run: () => {
          editing.onChange({ kind: 'remove', key: id });
        },
      },
    ];
  };

  const sectionActions = (edit: SectionEditing | null): MenuAction[] => {
    if (!edit) return [];
    return [
      { label: 'Rename', icon: Pencil, run: () => titleRef.current?.edit() },
      ...(imports.pick
        ? [{ label: 'Add image…', icon: Upload, disabled: imports.isImporting, run: imports.pick }]
        : []),
      {
        label: 'Move up',
        icon: ArrowUp,
        disabled: !edit.canMoveUp,
        run: () => {
          edit.onChange({ kind: 'move', key: section.id, by: -1 });
        },
      },
      {
        label: 'Move down',
        icon: ArrowDown,
        disabled: !edit.canMoveDown,
        run: () => {
          edit.onChange({ kind: 'move', key: section.id, by: 1 });
        },
      },
      {
        label: 'Remove section',
        icon: Trash,
        danger: true,
        run: () => {
          edit.onChange({ kind: 'remove', key: section.id });
        },
      },
    ];
  };

  const renderItem = (item: StandaloneItem) => {
    const itemMark = marks.get(item.id);
    switch (item.kind) {
      case 'note':
        return (
          <NoteCard
            key={item.id}
            kitId={kitId}
            note={item}
            mark={itemMark}
            noteLabels={noteLabels}
            actions={itemActions(item.id)}
            isNew={item.id === justAdded}
            onChange={onChange}
          />
        );
      case 'group':
        return (
          tokenKind && (
            <TokenTable
              key={item.id}
              group={item}
              kind={tokenKind}
              kitId={kitId}
              mode={mode}
              specimens={specimens}
              marks={marks}
              baseTokens={baseTokens}
              tokenNames={tokenNames}
              actions={itemActions(item.id)}
              isNew={item.id === justAdded}
              onChange={onChange}
            />
          )
        );
      case 'preview':
        return (
          <PreviewItem
            key={item.id}
            preview={item}
            mark={itemMark}
            previewing={previewing}
            previewTitles={previewTitles}
            actions={itemActions(item.id)}
            onChange={onChange}
          />
        );
    }
  };

  const renderRun = (run: ItemRun) =>
    run.kind === 'assets' ? (
      <AssetGrid
        key={run.items[0].id}
        assets={run.items}
        marks={marks}
        assetNames={assetNames}
        actionsFor={itemActions}
        onChange={onChange}
      />
    ) : (
      renderItem(run.item)
    );

  return (
    <section
      data-section-id={section.id}
      aria-label={section.title}
      className="relative flex scroll-mt-4 flex-col gap-4"
      {...imports.dropHandlers}
    >
      {imports.isOver && <ImageDropCue />}
      <SectionHeading
        section={section}
        mark={mark}
        count={count}
        titleRef={titleRef}
        onChange={onChange}
        actions={sectionActions(editing)}
      />
      {!isRemoved && section.kind === 'tokens' && (
        <p className="text-body text-secondary">
          These tokens sit outside the standard groups; designs can use them by name.
        </p>
      )}
      {!isRemoved &&
        (section.items.length === 0 ? (
          <div className="flex items-center gap-3">
            <p className="text-body text-muted">
              {imports.pick
                ? 'Drop PNG, JPEG or WebP images here.'
                : 'Nothing in this section yet.'}
            </p>
            {editing && (
              <div className="flex gap-1">
                <AddRow
                  offers={{ note: true, group: holdsTokens }}
                  onAdd={(kind) => {
                    editing.onAdd(kind);
                  }}
                />
                {imports.pick && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Upload}
                    loading={imports.isImporting}
                    onClick={imports.pick}
                  >
                    Image…
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <ProposalMarks.Provider
            value={proposal && mark === 'added' ? IN_ADDED_SECTION : proposal}
          >
            <div className="flex flex-col gap-6">
              {blocksWithAddRows(section, editing, holdsTokens, renderRun)}
              {typeSpecimen && <TypeSpecimen size={typeSpecimen} previewing={previewing} />}
            </div>
          </ProposalMarks.Provider>
        ))}
    </section>
  );
}

function SectionHeading({
  section,
  mark,
  count,
  titleRef,
  onChange,
  actions,
}: {
  section: DocumentSection;
  mark: DraftMark | undefined;
  count: number;
  titleRef: RefObject<InlineFieldHandle | null>;
  onChange: ((change: DraftChange) => void) | null;
  actions: MenuAction[];
}) {
  const isRemoved = mark === 'removed';
  return (
    <header className="relative flex min-h-control-md items-center gap-2">
      <UnsavedMark mark={mark} />
      <h2 tabIndex={-1} className="kit-heading-font flex min-w-0 items-baseline gap-2 outline-none">
        {onChange && !isRemoved ? (
          <InlineField
            ref={titleRef}
            value={section.title}
            label={`Title of the ${section.title} section`}
            check={(title) =>
              title.length > 0 && title.length <= MAX_TITLE_LENGTH
                ? null
                : 'A title is 1 to 120 characters.'
            }
            onCommit={(title) => {
              onChange({ kind: 'retitle', id: section.id, title });
            }}
            className="text-heading text-primary"
          />
        ) : (
          <span
            className={cn(
              'truncate text-heading',
              isRemoved ? 'text-muted line-through' : 'text-primary',
            )}
          >
            {section.title}
          </span>
        )}
        {!isRemoved && (
          <span className="shrink-0 text-caption tabular-nums text-muted">{count}</span>
        )}
      </h2>
      <AddedLabel mark={mark} />
      <span className="flex-1" />
      {onChange &&
        (isRemoved ? (
          <UndoRemove label={section.title} removedKey={section.id} onChange={onChange} />
        ) : (
          <ActionMenu label={`${section.title} section actions`} actions={actions} />
        ))}
    </header>
  );
}

/** The section's blocks, with an add row in each gap and at the end. */
function blocksWithAddRows(
  section: DocumentSection,
  editing: SectionEditing | null,
  holdsTokens: boolean,
  renderRun: (run: ItemRun) => ReactNode,
): ReactNode[] {
  const offers = { note: true, group: holdsTokens };
  const blocks: ReactNode[] = [];
  for (const run of itemRuns(section.items)) {
    const first = run.kind === 'assets' ? run.items[0] : run.item;
    if (editing && blocks.length > 0)
      blocks.push(
        <AddRow
          key={`add-${first.id}`}
          offers={offers}
          between
          onAdd={(kind) => {
            editing.onAdd(kind, first.id);
          }}
        />,
      );
    blocks.push(renderRun(run));
  }
  if (editing)
    blocks.push(
      <AddRow
        key="add-end"
        offers={offers}
        onAdd={(kind) => {
          editing.onAdd(kind);
        }}
      />,
    );
  return blocks;
}

// Only a token section holds groups.
function tokenKindOf(section: DocumentSection): TokenKind | null {
  const { kind } = section;
  return kind === 'notes' || kind === 'components' || kind === 'assets' ? null : kind;
}

// Assets read as a grid, so neighbouring assets share one; everything else
// stands alone in the column.
type StandaloneItem = Exclude<DocumentItem, DocumentAsset>;
type ItemRun = { kind: 'assets'; items: DocumentAsset[] } | { kind: 'item'; item: StandaloneItem };

function itemRuns(items: DocumentItem[]): ItemRun[] {
  const runs: ItemRun[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (item.kind !== 'asset') runs.push({ kind: 'item', item });
    else if (last?.kind === 'assets') last.items.push(item);
    else runs.push({ kind: 'assets', items: [item] });
  }
  return runs;
}
