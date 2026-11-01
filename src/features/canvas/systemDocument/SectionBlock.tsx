// One section of the document (spec §5, §6): a heading with its count and
// menu, then its notes, token groups, previews and assets in reading order.

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash } from '@droidex/icons';
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
import type { DraftChange } from './documentDraft';
import type { DocumentItem, DraftMark } from './documentSections';
import { PreviewItem } from './DocumentPreview';
import { InlineField, type InlineFieldHandle } from './InlineField';
import type { KitPreviewing } from './KitPreviewTile';
import { NoteCard } from './NoteCard';
import { TokenTable } from './TokenTable';
import { TypeSpecimen, type TypeSpecimenSize } from './TypeSpecimen';
import { UndoRemove, UnsavedMark } from './UnsavedMark';

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
  previewing: KitPreviewing;
  /** The saved version's type specimen, which follows this section's groups. */
  typeSpecimen: TypeSpecimenSize | null;
  /** The item or section the user just added, which opens for editing. */
  justAdded: string | null;
  editing: SectionEditing | null;
}) {
  const titleRef = useRef<InlineFieldHandle>(null);
  const mark = marks.get(section.id);
  const isRemoved = mark === 'removed';
  const onChange = editing?.onChange ?? null;
  const tokenKind = tokenKindOf(section);
  const holdsTokens = tokenKind !== null;

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

  const sectionActions = (edit: SectionEditing): MenuAction[] => [
    { label: 'Rename', icon: Pencil, run: () => titleRef.current?.edit() },
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

  const renderItem = (item: DocumentItem) => {
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
      case 'asset':
        return (
          <AssetTile
            key={item.id}
            asset={item}
            mark={itemMark}
            actions={itemActions(item.id)}
            onChange={onChange}
          />
        );
    }
  };

  return (
    <section
      data-section-id={section.id}
      aria-label={section.title}
      className="flex scroll-mt-4 flex-col gap-4"
    >
      <header className="relative flex min-h-control-md items-center gap-2">
        <UnsavedMark mark={mark} />
        <h2
          tabIndex={-1}
          className="kit-heading-font flex min-w-0 items-baseline gap-2 outline-none"
        >
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
          {!isRemoved && <span className="shrink-0 text-caption text-muted">{count}</span>}
        </h2>
        <span className="flex-1" />
        {editing &&
          (isRemoved ? (
            <UndoRemove label={section.title} removedKey={section.id} onChange={editing.onChange} />
          ) : (
            <ActionMenu
              label={`${section.title} section actions`}
              actions={sectionActions(editing)}
            />
          ))}
      </header>
      {!isRemoved && section.kind === 'tokens' && (
        <p className="text-body text-secondary">
          The shared primitives do not read these; designs can use them by name.
        </p>
      )}
      {!isRemoved &&
        (section.items.length === 0 ? (
          <div className="flex items-center gap-3">
            <p className="text-body text-muted">Nothing in this section yet.</p>
            {editing && (
              <AddRow
                offers={{ note: true, group: holdsTokens }}
                onAdd={(kind) => {
                  editing.onAdd(kind);
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {blocksWithAddRows(section, editing, holdsTokens, renderItem)}
            {typeSpecimen && <TypeSpecimen size={typeSpecimen} previewing={previewing} />}
          </div>
        ))}
    </section>
  );
}

/** The section's blocks, with an add row in each gap and at the end. */
function blocksWithAddRows(
  section: DocumentSection,
  editing: SectionEditing | null,
  holdsTokens: boolean,
  renderItem: (item: DocumentItem) => ReactNode,
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
    blocks.push(
      run.kind === 'assets' ? (
        <div key={run.items[0].id} className="grid grid-cols-3 gap-4">
          {run.items.map(renderItem)}
        </div>
      ) : (
        renderItem(run.item)
      ),
    );
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
type ItemRun = { kind: 'assets'; items: DocumentAsset[] } | { kind: 'item'; item: DocumentItem };

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

// Kit images reach only preview guests (spec §8), so the tile stands in for one.
function AssetTile({
  asset,
  mark,
  actions,
  onChange,
}: {
  asset: DocumentAsset;
  mark: DraftMark | undefined;
  actions: MenuAction[];
  onChange: ((change: DraftChange) => void) | null;
}) {
  const isRemoved = mark === 'removed';
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <div
        role="img"
        aria-label={asset.name}
        className="flex aspect-square items-center justify-center rounded-lg bg-surface text-caption text-muted"
      >
        Image
      </div>
      <figcaption className="relative flex min-h-control-sm items-center gap-1.5">
        <UnsavedMark mark={mark} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body',
            isRemoved ? 'text-muted line-through' : 'text-primary',
          )}
        >
          {asset.name}
        </span>
        {onChange &&
          (isRemoved ? (
            <UndoRemove label={asset.name} removedKey={asset.id} onChange={onChange} />
          ) : (
            <ActionMenu label={`${asset.name} actions`} actions={actions} />
          ))}
      </figcaption>
      {!isRemoved && asset.note !== undefined && (
        <p className="text-caption text-muted">{asset.note}</p>
      )}
    </figure>
  );
}
