// A design system's document in the canvas area, in place of the board (spec
// §4-§6, §10, §11): a header, a section nav and the document column. The
// user's own kits edit in place through a draft, and show the agent's proposal
// for review; presets and older versions read only.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Copy } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { useStoreSelector } from '../../../hooks/useStore';
import { resolveScheme } from '../../../lib/theme';
import { CanvasAction, CanvasNote, CanvasPlate, CanvasStatus } from '../CanvasPaneStates';
import { chooseDesignSystem, useDesignSystemChoice } from '../designSystemChoices';
import type { DocumentSection } from '../designSystemDocumentProtocol';
import type { DesignSystemDocumentView } from '../protocol';
import { PreviewModeButton, PreviewModeToggle, type PreviewMode } from '../PreviewModeToggle';
import { DocumentCover } from './DocumentCover';
import {
  addableSectionKinds,
  changeCount,
  currentDraft,
  draftOf,
  editDraft,
  freshGroup,
  freshNote,
  freshSection,
  useDocumentDraft,
  type DraftChange,
} from './documentDraft';
import { DocumentHeader, DocumentNotice, OlderVersionNotice, UseInCanvas } from './DocumentHeader';
import { DocumentMenu, useDuplicate } from './DocumentMenu';
import { DocumentNav, SectionsMenu, useActiveSection, type DocumentNavProps } from './DocumentNav';
import { itemCount, searchSections } from './documentSearch';
import {
  changedTokenValues,
  documentNames,
  draftDiff,
  isMarked,
  tokensByName,
  withRemoved,
  type DraftMark,
  type SectionKind,
} from './documentSections';
import type { KitPreviewing } from './KitPreviewTile';
import { ProposalLine } from './ProposalLine';
import {
  endReview,
  IN_REVIEW,
  ProposalMarks,
  startReview,
  useIsReviewing,
  useProposalDecision,
} from './proposalReview';
import { ProvenanceLine } from './ProvenanceLine';
import { ProposalBar, SaveBar, useSaveDraft } from './SaveBar';
import { SectionBlock, type SectionEditing } from './SectionBlock';
import { specimenProperties } from './specimenStyle';
import { typeSpecimenSize } from './TypeSpecimen';
import { useDesignSystemDocument } from './useDesignSystemDocument';
import { useKitPreviewSlots } from './useKitPreviewSlots';
import './designSystemDocument.css';

// Below this canvas width the nav folds into the header's Sections menu.
const NAV_FOLD_WIDTH_PX = 960;
const NO_MARKS: ReadonlyMap<string, DraftMark> = new Map();
const NO_TOKENS: Readonly<Record<string, string>> = {};

export function DesignSystemDocument({
  appSessionId,
  canvasKey,
  system,
  onBack,
}: {
  /** The chat whose canvas area shows the document. */
  appSessionId: string;
  /** The canvas whose choice Use in this canvas sets. */
  canvasKey: string;
  system: { id: string; version?: number };
  onBack: () => void;
}) {
  const { read, show } = useDesignSystemDocument(system.id, system.version);

  // Open popovers and edits take Escape first through the escape stack, so it
  // reaches here only with nothing open.
  const leaveOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onBack();
  };

  return (
    <div
      tabIndex={-1}
      onKeyDown={leaveOnEscape}
      className="flex h-full min-h-0 flex-col bg-bg outline-none"
    >
      {read.status === 'loading' && <CanvasStatus label="Reading the design system…" />}
      {read.status === 'failed' && (
        <CanvasPlate title="This design system did not open">
          <CanvasNote>{read.message}</CanvasNote>
          <div className="flex gap-1.5">
            <CanvasAction
              label="Try again"
              onClick={() => {
                void show(system.version ?? 'latest');
              }}
            />
            <CanvasAction label="Back to board" onClick={onBack} />
          </div>
        </CanvasPlate>
      )}
      {read.status === 'ready' && (
        <KitDocument
          key={read.view.id}
          view={read.view}
          appSessionId={appSessionId}
          canvasKey={canvasKey}
          onShow={show}
          onBack={onBack}
        />
      )}
    </div>
  );
}

function KitDocument({
  view,
  appSessionId,
  canvasKey,
  onShow,
  onBack,
}: {
  view: DesignSystemDocumentView;
  appSessionId: string;
  canvasKey: string;
  onShow: (target: number | 'latest') => Promise<void>;
  onBack: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draft = useDocumentDraft(view.id);
  const appMode = useStoreSelector((state) => state.theme.mode);
  const choice = useDesignSystemChoice(canvasKey);
  const isChosen = choice !== null && choice.ref.id === view.id;
  const [mode, setMode] = useState<PreviewMode>(() =>
    choice !== null && choice.ref.id === view.id ? choice.ref.mode : resolveScheme(appMode),
  );
  const [query, setQuery] = useState('');
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const wide = useIsWide(rootRef);
  const duplicate = useDuplicate(view, appSessionId);
  const saving = useSaveDraft(view.id);
  const isReviewing = useIsReviewing(view.id);
  const decision = useProposalDecision(view, onShow);

  const change = useCallback(
    (next: DraftChange) => {
      editDraft(view, next);
      keepFocusIn(scrollRef, next.kind === 'remove' ? next.key : undefined);
    },
    [view],
  );
  const isLatest = view.version === view.latestVersion;
  const canEdit = view.kind === 'user' && isLatest;
  // A draft and a proposal show only over the latest version of the user's own
  // kit, and the proposal under review shows in place of the draft.
  const proposal = canEdit ? view.proposal : null;
  const reviewed = isReviewing ? proposal : null;
  const isEditable = canEdit && reviewed === null;
  const editing = isEditable ? draft : null;
  const onChange = isEditable ? change : null;
  const base = editing?.base ?? view;
  const working = reviewed ?? editing ?? draftOf(view);
  const changed = reviewed ?? editing;
  const marks = changed ? draftDiff(base.sections, changed.sections) : NO_MARKS;
  const proposalCount = useMemo(
    () => (proposal ? changeCount({ ...proposal, base: view }) : 0),
    [proposal, view],
  );
  const isDrafting = draft !== null;
  const isInReview = reviewed !== null;
  useEffect(() => {
    keepFocusIn(scrollRef);
  }, [isDrafting, isInReview]);
  const isRemoved = (key: string) => marks.get(key) === 'removed';
  const shown =
    marks.size > 0 ? withRemoved(base.sections, working.sections, marks) : working.sections;
  const visible = searchSections(shown, query);
  const active = useActiveSection(
    scrollRef,
    visible.map((section) => section.id),
  );
  const specimens = useMemo(
    () => ({
      light: specimenProperties(working.sections, 'light'),
      dark: specimenProperties(working.sections, 'dark'),
    }),
    [working.sections],
  );
  const names = documentNames(working.sections);
  const baseTokens = new Map(
    Array.from(tokensByName(base.sections), ([name, { token }]) => [name, token]),
  );
  // Previews build from the version a draft or proposal changes, and show its values live.
  const draftTokens = useMemo(
    () => (changed ? changedTokenValues(base.sections, changed.sections, mode) : NO_TOKENS),
    [base.sections, changed, mode],
  );
  const slots = useKitPreviewSlots(scrollRef, base);
  const typeSpecimen = typeSpecimenSize(base.sections);
  const previewing: KitPreviewing = {
    kit: { id: base.id, version: base.version, mode },
    draftTokens,
    ...slots,
  };

  // Scrolls the column alone: scrollIntoView would also scroll the pane's
  // clipped ancestors and push the header out of the window.
  const jump = (id: string) => {
    const column = scrollRef.current;
    const section = column?.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
    if (!column || !section) return;
    const top =
      section.getBoundingClientRect().top -
      column.getBoundingClientRect().top +
      column.scrollTop -
      parseFloat(getComputedStyle(section).scrollMarginTop);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    column.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };

  const addItem = (sectionId: string, kind: 'note' | 'group') => {
    const current = currentDraft(view.id) ?? draftOf(view);
    const item = kind === 'note' ? freshNote(current) : freshGroup(current, 'New group');
    change({ kind: 'addItem', sectionId, item });
    setJustAdded(item.id);
  };

  const addSection = (kind: SectionKind) => {
    const section = freshSection(currentDraft(view.id) ?? draftOf(view), kind);
    change({ kind: 'addSection', section });
    setQuery('');
    requestAnimationFrame(() => {
      jump(section.id);
    });
  };

  const sectionEditing = (section: DocumentSection): SectionEditing | null => {
    if (!onChange) return null;
    const at = working.sections.findIndex((live) => live.id === section.id);
    return {
      itemIds: at < 0 ? [] : working.sections[at].items.map((item) => item.id),
      canMoveUp: at > 0,
      canMoveDown: at >= 0 && at < working.sections.length - 1,
      onChange,
      onAdd: (kind) => {
        addItem(section.id, kind);
      },
    };
  };

  const saveOnShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (!isEditable) return;
    // Leaving the focused field first keeps what it holds in the draft, which
    // may be the edit that starts it.
    scrollRef.current?.focus({ preventScroll: true });
    void saving.save();
  };

  const navProps: DocumentNavProps = {
    entries: visible.map((section) => ({
      id: section.id,
      title: section.title,
      count: itemCount(section, isRemoved),
      isMarked: isMarked(section, marks),
      isRemoved: isRemoved(section.id),
    })),
    active,
    query,
    onQueryChange: setQuery,
    onJump: jump,
    addable: isEditable ? addableSectionKinds(working.sections) : null,
    onAddSection: addSection,
  };

  return (
    <div ref={rootRef} onKeyDown={saveOnShortcut} className="flex min-h-0 flex-1 flex-col">
      <DocumentHeader
        view={view}
        name={working.name}
        onRename={
          onChange &&
          ((name) => {
            onChange({ kind: 'setName', name });
          })
        }
        onBack={onBack}
        onShowVersion={(version) => {
          void onShow(version);
        }}
      >
        {(room) => (
          <>
            {!wide && <SectionsMenu {...navProps} labelled={room.navWords} />}
            {room.modeWords ? (
              <PreviewModeToggle mode={mode} onChange={setMode} />
            ) : (
              <PreviewModeButton mode={mode} onChange={setMode} />
            )}
            <DocumentMenu view={view} onDuplicate={duplicate} onBack={onBack} />
            {isLatest && !editing && !reviewed && !isChosen && (
              <UseInCanvas
                short={!room.fullPrimary}
                onUse={() => {
                  chooseDesignSystem(canvasKey, {
                    ref: { id: view.id, version: view.version, mode },
                    name: view.name,
                  });
                }}
              />
            )}
          </>
        )}
      </DocumentHeader>
      <ProposalLine
        proposal={proposal}
        count={proposalCount}
        isReviewing={isInReview}
        decision={decision.decision}
        onReview={() => {
          startReview(view.id);
        }}
        onCloseReview={() => {
          endReview(view.id);
        }}
        onDiscard={decision.discard}
      />
      {!isLatest && <OlderVersionNotice key={view.version} view={view} onShow={onShow} />}
      {isLatest && view.kind === 'preset' && (
        <DocumentNotice text="Presets are read-only">
          <Button variant="secondary" size="sm" icon={Copy} onClick={duplicate}>
            Duplicate
          </Button>
        </DocumentNotice>
      )}
      <div className="flex min-h-0 flex-1">
        {wide && (
          <aside className="w-56 shrink-0 overflow-y-auto pb-6 pl-2 pr-1 pt-1">
            <DocumentNav {...navProps} />
          </aside>
        )}
        <div
          ref={scrollRef}
          tabIndex={-1}
          className="design-system-document-column min-h-0 min-w-0 flex-1 overflow-y-auto outline-none"
        >
          <ProposalMarks.Provider value={reviewed && IN_REVIEW}>
            <div className="flex flex-col gap-8 px-8 pb-8 pt-2">
              <div className="flex flex-col gap-2">
                <DocumentCover
                  appSessionId={appSessionId}
                  name={working.name}
                  cover={working.cover}
                  specimen={specimens[mode]}
                  previewing={previewing}
                  canRegenerate={isEditable}
                />
                <ProvenanceLine provenance={view.provenance} unmapped={view.unmapped.length} />
              </div>
              {visible.map((section) => (
                <SectionBlock
                  key={section.id}
                  section={section}
                  count={itemCount(section, isRemoved)}
                  kitId={view.id}
                  mode={mode}
                  specimens={specimens}
                  marks={marks}
                  baseTokens={baseTokens}
                  tokenNames={names.tokenNames}
                  noteLabels={names.noteLabels}
                  previewTitles={names.previewTitles}
                  previewing={previewing}
                  typeSpecimen={section.kind === 'typography' ? typeSpecimen : null}
                  justAdded={justAdded}
                  editing={sectionEditing(section)}
                />
              ))}
              {query !== '' && visible.length === 0 && (
                <p className="text-body text-muted">Nothing in this design system matches.</p>
              )}
            </div>
          </ProposalMarks.Provider>
          {reviewed && (
            <ProposalBar
              latestVersion={view.latestVersion}
              isStale={reviewed.baseVersion < view.latestVersion}
              hasDraft={isDrafting}
              decision={decision.decision}
              onAccept={decision.accept}
              onDiscard={decision.discard}
            />
          )}
          {editing && (
            <SaveBar
              count={changeCount(editing)}
              state={saving.state}
              onSave={() => {
                void saving.save();
              }}
              onDiscard={saving.discard}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A control that unmounts while focused (an item's menu on Remove, the save bar
 * when the draft ends, the picker that opened the document) leaves focus on the
 * body, out of reach of ⌘S and Escape. It moves to the column instead, or to
 * the removed item's Undo.
 */
function keepFocusIn(scrollRef: RefObject<HTMLElement | null>, removedKey?: string) {
  requestAnimationFrame(() => {
    const column = scrollRef.current;
    if (!column || document.activeElement !== document.body) return;
    const undo =
      removedKey === undefined
        ? null
        : column.querySelector<HTMLElement>(`[data-removed-key="${CSS.escape(removedKey)}"]`);
    (undo ?? column).focus({ preventScroll: true });
  });
}

function useIsWide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => {
      setWide(width >= NAV_FOLD_WIDTH_PX);
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return wide;
}
