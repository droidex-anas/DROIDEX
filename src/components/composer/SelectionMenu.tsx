import { useRef } from 'react';
import {
  Bold,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Scissors,
  SquareCode,
  Table,
  TextSelect,
} from 'lucide-react';
import type { DraftFormatAction } from '../../lib/composerFormatting';
import { Clock, type IconComponent } from '@droidex/icons';
import { Menu } from '../ui/Menu';

/* The composer's right-click menu. On a link it leads with opening or copying
   that link; then the editing actions every desktop app has — the draft cancels
   the platform menu to show this one, so it has to carry them itself; then
   formatting as compact icon rows, so the whole menu reads at a glance instead
   of scrolling through a column of labels. Selection-scoped actions (bold,
   link) hit what is selected; line-scoped ones (headings, lists, tables, code
   blocks) hit the line the caret is on. The menu only reports actions, so the
   draft stays owned by the composer. */

export type DraftEditAction = 'cut' | 'copy' | 'paste' | 'selectAll';

// Where the draft was right-clicked and what was under the pointer. Screen
// coordinates, because the menu floats at the pointer rather than anchoring
// inside the editor's layout.
export interface SelectionMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
  // The address under the pointer when the click landed on a link.
  link: string | null;
}

// [icon, label, action, shortcut, needsSelection]
const EDIT_ROWS: [IconComponent, string, DraftEditAction, string, boolean][] = [
  [Scissors, 'Cut', 'cut', '⌘X', true],
  [Copy, 'Copy', 'copy', '⌘C', true],
  [ClipboardPaste, 'Paste', 'paste', '⌘V', false],
  [TextSelect, 'Select All', 'selectAll', '⌘A', false],
];

// [icon, name, action, shortcut] — inline marks, then line structure, then blocks.
type FormatButton = [IconComponent, string, DraftFormatAction, string?];

const FORMAT_GROUPS: FormatButton[][] = [
  [
    [Bold, 'Bold', 'bold', '⌘B'],
    [Italic, 'Italic', 'italic', '⌘I'],
    [Code, 'Inline code', 'inlineCode', '⌘E'],
    [Link2, 'Link', 'link'],
  ],
  [
    [Heading1, 'Heading 1', 'heading1'],
    [Heading2, 'Heading 2', 'heading2'],
    [Heading3, 'Heading 3', 'heading3'],
    [Quote, 'Quote', 'quote'],
  ],
  [
    [List, 'Bulleted list', 'bulletList'],
    [ListOrdered, 'Numbered list', 'numberedList'],
    [ListTodo, 'Task list', 'taskList'],
    [Table, 'Table', 'table'],
    [SquareCode, 'Code block', 'codeBlock'],
  ],
];

export default function SelectionMenu({
  menu,
  onFormat,
  onEdit,
  onClose,
  onSchedule,
  canSchedule = false,
}: {
  menu: SelectionMenuState | null;
  onFormat: (action: DraftFormatAction) => void;
  onEdit: (action: DraftEditAction) => void;
  onClose: () => void;
  onSchedule?: (() => void) | undefined;
  canSchedule?: boolean;
}) {
  // A point at the pointer for the menu to open against; it grows upward
  // (the draft sits at the bottom of the window) and flips below near the top.
  const pointRef = useRef<HTMLSpanElement>(null);
  const link = menu?.link;

  return (
    <>
      {menu && (
        <span
          ref={pointRef}
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: menu.x, top: menu.y }}
        />
      )}
      <Menu
        open={menu !== null}
        onClose={onClose}
        anchorRef={pointRef}
        label="Prompt actions"
        placement="top-start"
        width={200}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        {link ? (
          <>
            <Menu.Item
              icon={ExternalLink}
              onSelect={() => window.open(link, '_blank', 'noopener,noreferrer')}
            >
              Open Link
            </Menu.Item>
            <Menu.Item
              icon={ClipboardCopy}
              onSelect={() => {
                navigator.clipboard.writeText(link).catch((error: unknown) => {
                  console.warn('Clipboard write failed', error);
                });
              }}
            >
              Copy Link Address
            </Menu.Item>
            <Menu.Divider />
          </>
        ) : null}
        {onSchedule && (
          <>
            <Menu.Item icon={Clock} disabled={!canSchedule} onSelect={onSchedule}>
              Schedule prompt…
            </Menu.Item>
            <Menu.Divider />
          </>
        )}
        {EDIT_ROWS.map(([icon, label, action, shortcut, needsSelection]) => (
          <Menu.Item
            key={action}
            icon={icon}
            disabled={needsSelection && !menu?.hasSelection}
            onSelect={() => {
              onEdit(action);
            }}
          >
            {label}
            <Menu.Shortcut>{shortcut}</Menu.Shortcut>
          </Menu.Item>
        ))}
        <Menu.Divider />
        {FORMAT_GROUPS.map((group, index) => (
          <div key={index} className="grid grid-cols-5">
            {group.map(([icon, name, action, shortcut]) => (
              <Menu.Item
                key={action}
                icon={icon}
                aria-label={name}
                title={shortcut ? `${name}  ${shortcut}` : name}
                className="justify-center"
                onSelect={() => {
                  onFormat(action);
                }}
              />
            ))}
          </div>
        ))}
      </Menu>
    </>
  );
}
