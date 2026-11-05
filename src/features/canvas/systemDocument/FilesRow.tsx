// The nav's last row: the kit's files in a menu. Choosing one scrolls to where
// the document shows it.

import { useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import { File, FileImage, FileText, type IconComponent } from '@droidex/icons';
import { Menu } from '../../../components/ui/Menu';
import type { KitFile } from './kitFiles';

const GROUPS: { kind: KitFile['kind']; label: string; icon: IconComponent }[] = [
  { kind: 'note', label: 'Notes', icon: FileText },
  { kind: 'example', label: 'Examples', icon: File },
  { kind: 'asset', label: 'Assets', icon: FileImage },
];

export function FilesRow({ files, onOpen }: { files: KitFile[]; onOpen: (file: KitFile) => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left text-body text-muted transition-colors hover:bg-elevated hover:text-primary aria-expanded:bg-elevated aria-expanded:text-primary"
      >
        <Folder aria-hidden="true" strokeWidth={1.5} className="size-icon-sm shrink-0" />
        <span className="min-w-0 flex-1 truncate">Files</span>
        <span className="shrink-0 text-caption tabular-nums">{files.length}</span>
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchorRef}
        label="Files"
        width={300}
        placement="right-end"
      >
        {files.length === 0 && <Menu.Label>No files yet</Menu.Label>}
        {GROUPS.map(({ kind, label, icon }) => {
          const group = files.filter((file) => file.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} role="group" aria-label={label}>
              <Menu.Label>{label}</Menu.Label>
              {group.map((file) => (
                <Menu.Item
                  key={file.name}
                  icon={icon}
                  disabled={file.shownAt === null}
                  onSelect={() => {
                    onOpen(file);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  {file.shownAt !== null && (
                    <span className="max-w-28 shrink-0 truncate text-caption text-muted">
                      {file.shownAt === 'cover' ? 'Cover' : file.shownAt.section}
                    </span>
                  )}
                </Menu.Item>
              ))}
            </div>
          );
        })}
      </Menu>
    </>
  );
}
