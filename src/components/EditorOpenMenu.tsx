import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileDiff, FolderOpen } from 'lucide-react';
import { listEditors, notify, openProject } from '../lib/desktop';
import { toast } from '../lib/toast';
import { EditorIcon } from './EditorIcon';
import { Menu } from './ui/Menu';
import {
  EDITOR_OPTIONS,
  editorLabel,
  getDefaultEditor,
  setDefaultEditor,
  type EditorId,
  type EditorTarget,
} from '../lib/editorOpen';

const TARGET_LABEL: Record<EditorTarget, string> = { codebase: 'codebase', diff: 'current diff' };

async function launch(cwd: string, editor: EditorId, target: EditorTarget) {
  try {
    await openProject(cwd, editor, target);
    toast.success(`Opened ${TARGET_LABEL[target]} in ${editorLabel(editor)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Could not open ${editorLabel(editor)}`);
    await notify('Could not open editor', message);
  }
}

export function openCodebase(cwd: string) {
  if (!cwd) return;
  void launch(cwd, getDefaultEditor(), 'codebase');
}

export function openCurrentDiff(cwd: string) {
  if (!cwd) return;
  void launch(cwd, getDefaultEditor(), 'diff');
}

export default function EditorOpenMenu({
  cwd,
  hasRepo = true,
  variant = 'panel',
}: {
  cwd: string;
  hasRepo?: boolean;
  variant?: 'panel' | 'toolbar';
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EditorId>(() => getDefaultEditor());
  const [installed, setInstalled] = useState<EditorId[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasCwd = Boolean(cwd);

  // Only offer editors that are actually present on this machine. If detection
  // returns nothing (e.g. running in a browser), fall back to the full list.
  const options =
    installed.length > 0 ? EDITOR_OPTIONS.filter((o) => installed.includes(o.id)) : EDITOR_OPTIONS;

  useEffect(() => {
    let cancelled = false;
    listEditors().then((found) => {
      if (cancelled || found.length === 0) return;
      setInstalled(found);
      // If the saved default isn't installed, fall back to the first available
      // one so the main button always opens something that exists.
      if (!found.includes(getDefaultEditor())) {
        setDefaultEditor(found[0]);
        setSelected(found[0]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseDefault = (editor: EditorId) => {
    setDefaultEditor(editor);
    setSelected(editor);
  };

  return (
    <>
      {variant === 'toolbar' ? (
        <div className="flex items-center rounded-sm overflow-hidden">
          <button
            onClick={() => hasCwd && openCodebase(cwd)}
            disabled={!hasCwd}
            title={
              hasCwd ? `Open codebase with ${editorLabel(selected)}` : 'No folder for this session'
            }
            className="flex items-center pl-1.5 pr-1 py-1.5 text-muted/80 hover:text-primary hover:bg-elevated/60 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <EditorIcon editor={selected} size={15} />
          </button>
          <button
            ref={buttonRef}
            onClick={() => {
              setOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={open}
            title="Editor actions"
            className={`flex items-center pr-1.5 pl-0.5 py-1.5 transition-colors ${
              open
                ? 'text-primary bg-elevated'
                : 'text-muted/80 hover:text-primary hover:bg-elevated/60'
            }`}
          >
            <ChevronDown
              className={`size-icon-sm transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      ) : (
        <button
          ref={buttonRef}
          onClick={() => {
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Open with ${editorLabel(selected)}`}
          className={`flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-label transition-colors ${
            open ? 'text-primary bg-elevated' : 'text-muted hover:text-primary hover:bg-elevated/60'
          }`}
        >
          <EditorIcon editor={selected} size={14} />
          <span className="max-w-20 truncate">{editorLabel(selected)}</span>
          <ChevronDown
            className={`size-icon-sm transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={buttonRef}
        label="Open with"
        placement="bottom-end"
        width={208}
      >
        <Menu.Item
          icon={FolderOpen}
          disabled={!hasCwd}
          onSelect={() => {
            void launch(cwd, selected, 'codebase');
          }}
        >
          Open codebase
        </Menu.Item>
        <Menu.Item
          icon={FileDiff}
          disabled={!hasCwd || !hasRepo}
          onSelect={() => {
            void launch(cwd, selected, 'diff');
          }}
        >
          Open current diff
          {!hasRepo && hasCwd && <span className="ml-auto text-caption text-muted">No repo</span>}
        </Menu.Item>

        <Menu.Divider />
        <Menu.Label>Default editor</Menu.Label>

        {options.map((option) => {
          const on = selected === option.id;
          return (
            <Menu.Item
              key={option.id}
              role="menuitemradio"
              aria-checked={on}
              onSelect={() => {
                chooseDefault(option.id);
              }}
            >
              <EditorIcon editor={option.id} size={16} />
              <span className="flex-1 truncate">{option.label}</span>
              {on && (
                <Check className="ml-auto size-icon-sm shrink-0 text-accent" aria-hidden="true" />
              )}
            </Menu.Item>
          );
        })}

        {!hasCwd && (
          <div className="px-2 py-1.5 text-caption text-muted">This session has no folder yet.</div>
        )}
      </Menu>
    </>
  );
}
