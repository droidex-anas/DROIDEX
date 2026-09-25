import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  useLayoutEffect,
  useRef,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { Check, FileText } from '@droidex/icons';

import { CatalogRowIcon } from './composer/CatalogRowIcon';
import { catalogLabel, rowScope, type MenuEntry, type MenuItem } from './composer/menuItems';
import { inlineCardMotion } from './inlineCardMotion';
import type { SkillInfo } from '../types/bridge';

/** One of DROIDEX's own commands, run on the client instead of sent to the agent. */
export interface SlashCommand {
  /** Stored with its `/` trigger for matching; the menu shows the bare name. */
  cmd: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
}

const ICON = 'h-4 w-4 shrink-0 text-droid-text-muted';

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function SectionHeading({ text, first }: { text: string; first: boolean }) {
  return (
    <div
      className={`px-2.5 pb-1 text-[11px] font-medium text-droid-text-muted ${first ? 'pt-1' : 'pt-3'}`}
    >
      {text}
    </div>
  );
}

// A plugin's skills sit under its name and mark, so the rows themselves can keep
// the skill glyph and still read as the plugin's.
function GroupHeading({ text, plugin }: { text: string; plugin: SkillInfo | null }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] text-droid-text-muted">
      {plugin && <CatalogRowIcon item={plugin} className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{text}</span>
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
        // A context or middle click must not run a command.
        if (e.button !== 0) return;
        e.preventDefault();
        onRun();
      }}
      onClick={runOnKeyboardClick}
      className={`flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${
        active ? 'bg-droid-accent/[0.07]' : ''
      }`}
    >
      {children}
      {marked && <Check aria-label="Added" className="h-3.5 w-3.5 shrink-0 text-droid-accent" />}
    </button>
  );
}

function Name({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[13px] font-medium text-droid-text">{children}</span>;
}

function Detail({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 truncate text-[12px] text-droid-text-muted">{children}</span>
  );
}

function Scope({ children }: { children: string }) {
  return <span className="shrink-0 text-[11px] text-droid-text-muted/70">{children}</span>;
}

function RowBody({ item, staged }: { item: MenuItem; staged: boolean }) {
  if (item.type === 'command') {
    const Icon = item.command.icon;
    return (
      <>
        <Icon className={ICON} />
        <Name>{item.command.cmd.slice(1)}</Name>
        <Detail>{item.command.desc}</Detail>
      </>
    );
  }
  if (item.type === 'file') {
    return (
      <>
        <FileText className={ICON} />
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
        <span className="shrink-0 font-mono text-[11px] text-droid-text-muted/70">
          {row.argumentHint}
        </span>
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
// keyed, so a row that arrives lands where it belongs without disturbing the
// query, the highlight, or the rows already painted. Rows paint at once — a
// per-row fade left rows blank and the panel looking empty whenever a query
// narrowed the list.
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
          className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-80 overflow-y-auto overscroll-contain rounded-2xl bg-droid-raised p-1.5 shadow-droid"
        >
          {entries.map((entry, i) => {
            if (entry.kind === 'section') {
              return <SectionHeading key={entry.key} text={entry.text} first={i === 0} />;
            }
            if (entry.kind === 'group') {
              return <GroupHeading key={entry.key} text={entry.text} plugin={entry.plugin} />;
            }
            const staged = stagedKeys.has(entry.key);
            return (
              <Row
                key={entry.key}
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
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
