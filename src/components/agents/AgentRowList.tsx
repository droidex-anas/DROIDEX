import { motion } from 'framer-motion';
import { INLINE_CARD_EASE } from '../inlineCardMotion';
import type { ChildSessionSummary, ProviderKind } from '../../types/bridge';
import { AgentRow } from './AgentRow';
import { agentListSections, type AgentRow as AgentRowModel } from './agentMonitorModel';

/* The expanded rows of the card and its docked line. They carry the same
   grouping as the agent pane — a workflow's own phases, or Active and Done —
   so a run reads the same wherever it is opened.

   Expanding a large wave reveals the first rows behind a "Show N more agents"
   fold, so paging older history into a long-running session never dumps dozens
   of rows (and their entrance stagger) at once. */

export const AGENT_VISIBLE_ROW_LIMIT = 8;

export function foldedAgentRows<T>(rows: readonly T[], showAll: boolean): T[] {
  return showAll ? [...rows] : rows.slice(0, AGENT_VISIBLE_ROW_LIMIT);
}

// The body opens a touch slower than the app's standard disclosure, because the
// count pills have to travel to their rows inside it; each row then lands one
// stagger apart behind them.
const AGENT_BODY_DURATION_S = 0.28;
const AGENT_ROW_STAGGER_S = 0.04;

/** Motion for the card's disclosure. Reduced motion drops the height travel and
    keeps a plain opacity swap, the same trade the inline cards make. */
export function agentDisclosureMotion(reduceMotion: boolean) {
  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.15 },
    };
  }
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: AGENT_BODY_DURATION_S, ease: INLINE_CARD_EASE },
  };
}

export function AgentRowList({
  rows,
  elapsedMs,
  provider,
  reduceMotion,
  dense,
  morphId,
  onOpen,
  onShowAll,
  foldedCount,
}: {
  rows: readonly AgentRowModel[];
  elapsedMs: ReadonlyMap<string, number | undefined>;
  provider?: ProviderKind;
  reduceMotion: boolean;
  dense?: boolean;
  // Present only while the collapsed pills can glide into these rows.
  morphId?: string;
  onOpen?: (child: ChildSessionSummary) => void;
  onShowAll?: () => void;
  foldedCount: number;
}) {
  // The first row of a status is where that status's count pill lands.
  const landingKeys = new Map<string, string>();
  for (const row of rows) {
    const status = row.queued ? 'queued' : row.status;
    if (!landingKeys.has(status)) landingKeys.set(status, row.key);
  }
  const pillLayoutId = (row: AgentRowModel): string | undefined => {
    const status = row.queued ? 'queued' : row.status;
    if (morphId === undefined || landingKeys.get(status) !== row.key) return undefined;
    return `${morphId}:${status}`;
  };

  return (
    <>
      {agentListSections(rows).map((section) => (
        <div key={section.key}>
          <div
            data-testid="agent-section-label"
            className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-[0.06em] text-droid-text-muted"
          >
            {section.label}
          </div>
          <motion.ul
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            variants={{ show: { transition: { staggerChildren: AGENT_ROW_STAGGER_S } } }}
            transition={{ duration: 0.2, ease: INLINE_CARD_EASE }}
            className="px-2 pb-1.5"
          >
            {section.rows.map((row) => (
              <AgentRow
                key={row.key}
                row={row}
                {...(provider !== undefined ? { provider } : {})}
                {...(dense !== undefined ? { dense } : {})}
                {...(elapsedMs.get(row.key) !== undefined
                  ? { durationMs: elapsedMs.get(row.key) }
                  : {})}
                {...(pillLayoutId(row) !== undefined ? { pillLayoutId: pillLayoutId(row) } : {})}
                {...(onOpen !== undefined ? { onOpen } : {})}
              />
            ))}
          </motion.ul>
        </div>
      ))}
      {foldedCount > 0 && onShowAll ? (
        <button
          type="button"
          onClick={onShowAll}
          className="w-full px-4 pb-3 pt-1 text-left text-[12px] text-droid-text-muted transition-colors hover:text-droid-text-secondary"
        >
          Show {foldedCount} more {foldedCount === 1 ? 'agent' : 'agents'}
        </button>
      ) : null}
    </>
  );
}
