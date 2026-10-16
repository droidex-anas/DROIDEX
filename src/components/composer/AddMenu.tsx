import { useRef, useState } from 'react';
import { FolderOpen, Plus } from '@droidex/icons';
import { VisualizeIcon } from '../icons/VisualizeIcon';
import { Menu } from '../ui/Menu';

function RowText({ label, hint }: { label: string; hint: string }) {
  return (
    <>
      <span className="shrink-0 text-body-strong">{label}</span>
      <span className="min-w-0 truncate text-caption text-muted">{hint}</span>
    </>
  );
}

// The plus button and what it opens: everything the next prompt can carry beyond
// words. Attachments and plugins live in one list so the button is a single entry
// point instead of a shortcut to the file picker.
export default function AddMenu({
  visualizeSelected,
  onAttachFiles,
  onToggleVisualize,
}: {
  visualizeSelected: boolean;
  onAttachFiles: () => void;
  onToggleVisualize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={`flex size-control-md shrink-0 items-center justify-center rounded-full transition-colors ${
          open ? 'bg-active text-primary' : 'text-muted hover:bg-active/60 hover:text-primary'
        }`}
        title="Add files or a plugin"
        aria-label="Add files or a plugin"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="size-icon-md" aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        label="Add to this prompt"
        placement="top-start"
        width={320}
      >
        <Menu.Label>Add</Menu.Label>
        <Menu.Item icon={FolderOpen} onSelect={onAttachFiles}>
          <RowText label="Files" hint="Attach files to this prompt" />
        </Menu.Item>
        <Menu.Label>Plugins</Menu.Label>
        <Menu.Item
          icon={VisualizeIcon}
          role="menuitemcheckbox"
          aria-checked={visualizeSelected}
          onSelect={onToggleVisualize}
        >
          <RowText label="Visualize" hint="Create an interactive in-chat App" />
          {visualizeSelected && (
            <span className="ml-auto shrink-0 text-caption text-accent">Added</span>
          )}
        </Menu.Item>
      </Menu>
    </>
  );
}
