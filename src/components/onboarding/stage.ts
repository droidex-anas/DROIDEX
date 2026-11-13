import type { ProviderKind } from '../../types/bridge';
import { AGENTS, type AgentStatus } from './agents';
import type { SetupStepId } from './StepProgress';
import type { InstallRun } from './useAgentSetup';

export type FlowStep = 'welcome' | SetupStepId | 'done';

/** One shape the stage draws in dots: the X of the DROIDEX mark or an agent's mark. */
export interface Figure {
  shape: 'x' | ProviderKind;
  x: number;
  y: number;
  size: number;
  /** Brightness from 0 to 1. */
  strength: number;
  /** Share of the shape lit from the bottom up; the rest stays a ghost. */
  fill: number;
  /** A light sweeps across the shape while something is live. */
  shimmer: boolean;
}

export interface AgentProgress {
  fill: number;
  shimmer: boolean;
}

export interface StageScene {
  step: FlowStep;
  chosen: readonly ProviderKind[];
  /** The agent drawn large: the one pointed at, being set up, or starting new chats. */
  lead: ProviderKind | null;
  progress: Record<ProviderKind, AgentProgress>;
}

// The stage's left edge fades in under the setup column.
export const FADE_WIDTH = 160;

// Scenes are laid out on a fixed board, then scaled into the stage's box.
const BOARD_WIDTH = 680;
const BOARD_HEIGHT = 760;
const BOARD_CENTER_X = 380;
const BOARD_CENTER_Y = 392;
const MAX_SCALE = 1.25;
const HERO_SIZE = 304;
const HERO_Y = 136;
const ROW_SIZE = 112;
const ROW_GAP = 24;
const ROW_Y = 536;
// Installing lights a mark to here; signing in lights the rest.
const INSTALLED_FILL = 0.6;
// Install output has no known length, so the fill only approaches
// INSTALLED_FILL as lines arrive, reaching half of it at this many.
const HALF_FILL_LINES = 12;

export function agentProgress(status: AgentStatus, run: InstallRun | null): AgentProgress {
  if (run?.outcome === 'running') {
    const lines = run.log.length;
    return { fill: (INSTALLED_FILL * lines) / (lines + HALF_FILL_LINES), shimmer: true };
  }
  if (status.state === 'ready') return { fill: 1, shimmer: false };
  if (status.state === 'signin') return { fill: INSTALLED_FILL, shimmer: false };
  return { fill: 0, shimmer: false };
}

const FULL: AgentProgress = { fill: 1, shimmer: false };

function hero(shape: Figure['shape'], { fill, shimmer }: AgentProgress = FULL): Figure {
  const x = BOARD_CENTER_X - HERO_SIZE / 2;
  return { shape, x, y: HERO_Y, size: HERO_SIZE, strength: 1, fill, shimmer };
}

function row(agents: readonly ProviderKind[], look: (agent: ProviderKind) => Partial<Figure>) {
  const width = agents.length * ROW_SIZE + (agents.length - 1) * ROW_GAP;
  const left = BOARD_CENTER_X - width / 2;
  return agents.map(
    (agent, index): Figure => ({
      shape: agent,
      x: left + index * (ROW_SIZE + ROW_GAP),
      y: ROW_Y,
      size: ROW_SIZE,
      strength: 0.9,
      ...FULL,
      ...look(agent),
    }),
  );
}

/** What the stage draws for each step, on the board. */
export function stageFigures({ step, chosen, lead, progress }: StageScene): Figure[] {
  switch (step) {
    case 'welcome':
      return [{ shape: 'x', x: BOARD_CENTER_X - 200, y: 176, size: 400, ...FULL, strength: 1 }];
    case 'agents': {
      const fill = (agent: ProviderKind) => (chosen.includes(agent) ? 1 : 0);
      const spotlight = lead ?? 'droid';
      return [
        hero(spotlight, { fill: fill(spotlight), shimmer: false }),
        ...row(AGENTS, (agent) => ({ fill: fill(agent) })),
      ];
    }
    case 'setup':
      return [
        lead === null ? hero('x') : hero(lead, progress[lead]),
        ...row(chosen, (agent) => progress[agent]),
      ];
    case 'defaults':
      return [
        hero(lead ?? 'x'),
        ...row(chosen, (agent) => ({
          strength: agent === lead ? 1 : 0.45,
          fill: progress[agent].fill,
        })),
      ];
    case 'done':
      return [hero('x'), ...row(chosen, (agent) => ({ fill: progress[agent].fill }))];
  }
}

// Scales the board into the stage's box, centred on the part the column leaves visible.
export function fitFigures(figures: readonly Figure[], width: number, height: number): Figure[] {
  const visibleWidth = width - FADE_WIDTH;
  const scale = Math.min(
    MAX_SCALE,
    visibleWidth / (BOARD_WIDTH - FADE_WIDTH),
    height / BOARD_HEIGHT,
  );
  const centerX =
    FADE_WIDTH + (visibleWidth * (BOARD_CENTER_X - FADE_WIDTH)) / (BOARD_WIDTH - FADE_WIDTH);
  const centerY = (height * BOARD_CENTER_Y) / BOARD_HEIGHT;
  return figures.map((figure) => ({
    ...figure,
    x: centerX + (figure.x - BOARD_CENTER_X) * scale,
    y: centerY + (figure.y - BOARD_CENTER_Y) * scale,
    size: figure.size * scale,
  }));
}
