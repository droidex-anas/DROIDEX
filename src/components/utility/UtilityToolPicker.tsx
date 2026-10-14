import type { RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { UtilityTool } from '../../lib/utilityPanel';
import { preloadLazySurface } from '../../lib/chunkPreloader';
import type { LazySurface } from '../../lib/lazySurfaces';
import { Menu } from '../ui/Menu';
import { utilityToolOption } from './utilityToolOptions';

const TOOL_SURFACES: Record<UtilityTool, LazySurface> = {
  review: 'review',
  browser: 'browser',
  terminal: 'terminal',
  files: 'files',
  agents: 'agents',
  threads: 'threads',
  side: 'sideChats',
};

function preloadHandlers(tool: UtilityTool) {
  const preload = () => {
    preloadLazySurface(TOOL_SURFACES[tool]);
  };
  return { onPointerEnter: preload, onFocus: preload };
}

// The empty pane shows the tools as a small tile grid.
export function UtilityToolGrid({
  tools,
  onSelect,
}: {
  tools: UtilityTool[];
  onSelect: (tool: UtilityTool) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div role="menu" aria-label="Utility tools" className="grid w-full grid-cols-2 gap-2.5">
      {tools.map((tool, index) => {
        const option = utilityToolOption(tool);
        const Icon = option.icon;
        return (
          <motion.button
            key={tool}
            type="button"
            role="menuitem"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
            {...preloadHandlers(tool)}
            onClick={() => {
              onSelect(tool);
            }}
            className="group flex select-none flex-col items-center justify-center gap-2.5 rounded-xl bg-elevated/50 px-3 py-6 text-label text-secondary transition-colors hover:bg-elevated hover:text-primary"
          >
            <Icon className="size-icon-lg text-muted transition-colors group-hover:text-primary" />
            <span>{option.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// The header's add menu: the tools as a compact list with their shortcuts.
export function UtilityToolMenu({
  open,
  onClose,
  anchorRef,
  tools,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  tools: UtilityTool[];
  onSelect: (tool: UtilityTool) => void;
}) {
  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-end"
      label="Open utility tool"
    >
      {tools.map((tool) => {
        const option = utilityToolOption(tool);
        return (
          <Menu.Item
            key={tool}
            icon={option.icon}
            {...preloadHandlers(tool)}
            onSelect={() => {
              onSelect(tool);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.shortcut && <Menu.Shortcut>{option.shortcut}</Menu.Shortcut>}
          </Menu.Item>
        );
      })}
    </Menu>
  );
}
