// The picker's footer (spec §9): New design system, opening the sources a kit
// can start from. Choosing a paste source hands its kind to the picker, which
// opens the form; From this project asks the chat's agent instead (design
// system documents spec §12).

import { useRef, useState } from 'react';
import { ChevronRight, Plus } from '@droidex/icons';
import { Menu } from '../../components/ui/Menu';
import type { DesignSystemSource } from './protocol';

/** The chat's project folder, by name, and asking its agent for a kit from it. */
export interface FromProject {
  folderName: string;
  onSelect: () => void;
}

export function NewDesignSystemMenu({
  onCompose,
  fromProject,
}: {
  onCompose: (kind: DesignSystemSource['kind']) => void;
  /** Null where the chat has no project folder or no Canvas tools. */
  fromProject: FromProject | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-primary transition-colors hover:bg-elevated aria-expanded:bg-elevated focus-visible:bg-elevated focus-visible:outline-none dark:hover:bg-active dark:aria-expanded:bg-active dark:focus-visible:bg-active"
      >
        <Plus aria-hidden className="size-icon-sm shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">New design system</span>
        <ChevronRight aria-hidden className="size-icon-sm shrink-0 text-muted" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        placement="right-end"
        width={240}
        label="New design system"
      >
        {fromProject && (
          <Menu.Item onSelect={fromProject.onSelect}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">From this project: {fromProject.folderName}</span>
              <span className="text-caption text-muted">
                Reads your Tailwind config, CSS tokens and design docs
              </span>
            </span>
          </Menu.Item>
        )}
        <Menu.Item
          onSelect={() => {
            onCompose('designMd');
          }}
        >
          From DESIGN.md…
        </Menu.Item>
        <Menu.Item
          onSelect={() => {
            onCompose('cssOrTailwind');
          }}
        >
          From CSS or Tailwind config…
        </Menu.Item>
      </Menu>
    </>
  );
}
