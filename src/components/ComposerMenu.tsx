import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';

import { CatalogRowIcon, CommandSigil } from './composer/CatalogRowIcon';
import { catalogLabel, rowScope, type MenuEntry, type MenuItem } from './composer/menuItems';
import { FileTypeIcon } from './FileTypeIcon';
import { inlineCardMotion, INLINE_CARD_EASE } from './inlineCardMotion';

const ACCENT = 'var(--droid-accent)';

export type SlashCommand =
  | { cmd: string; desc: string; replacement: string; run?: never }
  | { cmd: string; desc: string; replacement?: never; run: () => void };

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

// Commands are stored with their '/' trigger for matching and insertion; the
// menu shows the bare name.
function commandLabel(cmd: string): string {
  return cmd.startsWith('/') ? cmd.slice(1) : cmd;
}

function Label({ text, group, first }: { text: string; group: boolean; first: boolean }) {
  if (group) {
    return (
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-droid-text-muted/60">
        {text}
      </div>
    );
  }
  return (
    <div
      className={`px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-droid-text-muted/50 ${
        first ? 'pt-1' : 'pt-2.5'
      }`}
    >
      {text}
    </div>
  );
}

function Row({
  active,
  marked,
  onHover,
  onRun,
  children,
}: {
  active: boolean;
  /** Already staged on the draft, so the row says so instead of looking idle. */
  marked: boolean;
  onHover: () => void;
  onRun: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Arrow keys move the highlight while focus stays in the draft, so the panel
  // has to bring the highlighted row into view itself.
  useLayoutEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  // Mouse users run the row on mousedown (preventDefault keeps focus in the
  // draft). Keyboard and assistive-technology activation fire click with detail
  // 0 and no preceding mousedown, so run the row there too without
  // double-firing for mouse users.
  const runOnKeyboardClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) onRun();
  };
  return (
    <button
      ref={ref}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
      }}
      onClick={runOnKeyboardClick}
      className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active ? 'bg-droid-surface' : 'hover:bg-droid-surface/55'
      }`}
    >
      {children}
      {marked && (
        <span className="shrink-0 text-[11px] font-medium" style={{ color: ACCENT }}>
          Added
        </span>
      )}
    </button>
  );
}

function Name({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[13px] font-medium text-droid-text">{children}</span>;
}

function Detail({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto min-w-0 truncate text-right text-[12px] text-droid-text-muted/75">
      {children}
    </span>
  );
}

function Scope({ children }: { children: string }) {
  return <span className="shrink-0 text-[11px] text-droid-text-muted/55">{children}</span>;
}

function RowBody({ item, staged }: { item: MenuItem; staged: boolean }) {
  if (item.type === 'command') {
    return (
      <>
        <CommandSigil />
        <Name>{commandLabel(item.command.cmd)}</Name>
        <Detail>{item.command.desc}</Detail>
      </>
    );
  }
  if (item.type === 'file') {
    return (
      <>
        <FileTypeIcon filename={basename(item.path)} aria-hidden className="h-4 w-4 shrink-0" />
        <Name>{basename(item.path)}</Name>
        <Detail>{staged ? `Attached · ${item.path}` : item.path}</Detail>
      </>
    );
  }
  const { item: row } = item;
  return (
    <>
      <CatalogRowIcon item={row} />
      <Name>{catalogLabel(row)}</Name>
      {row.argumentHint && (
        <span className="shrink-0 text-[12px] text-droid-text-muted/60">{row.argumentHint}</span>
      )}
      <Detail>{row.description}</Detail>
      {/* Where a command or skill comes from is worth saying; an app or a
          plugin is already named by the section it sits in, and its
          marketplace would only crowd the row. */}
      {(row.kind === 'command' || row.kind === 'skill') && <Scope>{rowScope(row)}</Scope>}
    </>
  );
}

interface ComposerMenuProps {
  open: boolean;
  entries: MenuEntry[];
  /** The highlighted row, tracked by key so landing rows cannot move it. */
  activeKey: string | null;
  /** Rows already staged on the draft: skills, plugins, apps, attached files. */
  stagedKeys: ReadonlySet<string>;
  onHoverRow: (key: string) => void;
  onRunRow: (item: MenuItem) => void;
}

// The composer's / and @ menu: the bound harness's commands, skills, plugins and
// apps beside DROIDEX's own commands and the repository's files, in one
// keyboard-navigable list. Rendering only — trigger detection, which rows the
// harness offers, and keyboard handling stay in PromptInput and menuItems.
//
// The panel stays mounted while a harness's catalog lands in pieces: entries are
// keyed, so a row that arrives fades in where it belongs without disturbing the
// query, the highlight, or the rows already painted.
export default function ComposerMenu({
  open,
  entries,
  activeKey,
  stagedKeys,
  onHoverRow,
  onRunRow,
}: ComposerMenuProps) {
  const reduceMotion = useReducedMotion();
  const motionProps = inlineCardMotion(reduceMotion);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...motionProps}
          className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-80 overflow-y-auto rounded-xl border border-droid-border bg-droid-elevated p-1.5 shadow-droid"
        >
          {/* Keyed entries that mount as the catalog lands: only the new row
              fades in, and initial={false} keeps the rows the panel opened with
              from animating one by one. */}
          <AnimatePresence initial={false}>
            {entries.map((entry, i) => {
              const staged = entry.kind === 'row' && stagedKeys.has(entry.key);
              return (
                <motion.div
                  key={entry.key}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.14, ease: INLINE_CARD_EASE }}
                >
                  {entry.kind === 'label' ? (
                    <Label text={entry.text} group={entry.group} first={i === 0} />
                  ) : (
                    <Row
                      active={entry.key === activeKey}
                      marked={staged && entry.item.type !== 'file'}
                      onHover={() => {
                        onHoverRow(entry.key);
                      }}
                      onRun={() => {
                        onRunRow(entry.item);
                      }}
                    >
                      <RowBody item={entry.item} staged={staged} />
                    </Row>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
