import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderOpen, House } from 'lucide-react';
import { ghostButton } from '../../src/components/buttonStyles';
import { baseName, type Crumb, type ListingProblem } from './folderPaths';

export const FOLDER_LIST_ID = 'folder-picker-list';

export function folderOptionId(index: number): string {
  return `${FOLDER_LIST_ID}-${String(index)}`;
}

const hiddenScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** The current folder's path; going to an ancestor highlights the folder you came from. */
export function Breadcrumbs({
  crumbs,
  open,
}: {
  crumbs: Crumb[];
  open: (path: string, focusName: string | null) => void;
}) {
  const scroller = useRef<HTMLElement>(null);
  const currentPath = crumbs.at(-1)?.path;
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [currentPath]);

  return (
    <nav
      ref={scroller}
      aria-label="Folder path"
      className={`flex min-w-0 flex-1 items-center overflow-x-auto ${hiddenScrollbar}`}
    >
      {crumbs.length === 0 && <span className="skeleton-block h-4 w-40" />}
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex shrink-0 items-center">
            {index > 0 && (
              <ChevronRight size={13} aria-hidden className="text-droid-text-muted/70" />
            )}
            <button
              type="button"
              aria-current={current ? 'location' : undefined}
              onClick={() => {
                if (!current) open(crumb.path, crumbs[index + 1]?.label ?? null);
              }}
              className={`flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] transition-colors duration-150 hover:bg-droid-elevated focus-visible:bg-droid-elevated focus-visible:outline-none ${
                current ? 'font-medium text-droid-text' : 'text-droid-text-secondary'
              }`}
            >
              {crumb.isHome && <House size={13} aria-hidden />}
              {crumb.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Home and the laptop's workspaces: a side rail on wider screens, a chip row on phones. */
export function Places({
  home,
  workspaces,
  currentPath,
  open,
}: {
  home: string | null;
  workspaces: string[];
  currentPath: string | null;
  open: (path: string) => void;
}) {
  return (
    <nav
      aria-label="Places"
      className={`flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-2 sm:w-48 sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:px-3 sm:pb-3 ${hiddenScrollbar}`}
    >
      <PlaceButton
        label="Home"
        title={home ?? 'Home'}
        icon={<House size={14} aria-hidden />}
        current={currentPath !== null && currentPath === home}
        onClick={() => {
          open(home ?? '~');
        }}
      />
      <p className="hidden px-2.5 pb-1 pt-3 text-[11px] font-medium text-droid-text-muted sm:block">
        Workspaces
      </p>
      {workspaces.map((path) => (
        <PlaceButton
          key={path}
          label={baseName(path)}
          title={path}
          icon={<Folder size={14} aria-hidden />}
          current={currentPath === path}
          onClick={() => {
            open(path);
          }}
        />
      ))}
    </nav>
  );
}

function PlaceButton({
  label,
  title,
  icon,
  current,
  onClick,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-current={current ? 'location' : undefined}
      onClick={onClick}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12px] transition-colors duration-150 focus-visible:outline-none sm:w-full sm:rounded-lg sm:px-2.5 ${
        current
          ? 'bg-droid-active font-medium text-droid-text'
          : 'bg-droid-elevated text-droid-text-secondary hover:bg-droid-active hover:text-droid-text focus-visible:bg-droid-active sm:bg-transparent sm:hover:bg-droid-elevated sm:focus-visible:bg-droid-elevated'
      }`}
    >
      <span className="text-droid-text-muted">{icon}</span>
      <span className="max-w-[160px] truncate">{label}</span>
    </button>
  );
}

/** The folders of the current listing, or why there are none to show. */
export function FolderRows({
  rows,
  filter,
  active,
  ready,
  problem,
  recoverLabel,
  recover,
  setActive,
  openFolder,
}: {
  rows: string[];
  filter: string;
  active: number;
  ready: boolean;
  problem: ListingProblem | null;
  recoverLabel: string;
  recover: () => void;
  setActive: (index: number) => void;
  openFolder: (name: string) => void;
}) {
  if (problem)
    return (
      <div role="alert" className="flex flex-col items-start gap-1 px-3 py-6">
        <p className="text-[13px] font-medium text-droid-text">{problem.title}</p>
        <p className="max-w-[420px] text-[12px] leading-5 text-droid-text-secondary">
          {problem.detail}
        </p>
        <button type="button" className={`${ghostButton} -ml-3 mt-2`} onClick={recover}>
          {recoverLabel}
        </button>
      </div>
    );
  if (!ready) return <SkeletonRows />;
  if (rows.length === 0)
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <FolderOpen size={22} strokeWidth={1.5} className="mb-2 text-droid-text-muted" />
        <p className="text-[13px] text-droid-text">
          {filter ? `No folders match “${filter.trim()}”` : 'No folders inside'}
        </p>
        <p className="text-[12px] text-droid-text-muted">
          {filter ? 'Check the spelling or clear the filter.' : 'You can still use this folder.'}
        </p>
      </div>
    );
  return rows.map((name, index) => (
    <div
      key={name}
      id={folderOptionId(index)}
      role="option"
      aria-selected={index === active}
      // Keeps focus in the filter, so typing and arrow keys keep working after a click.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseMove={() => {
        if (index !== active) setActive(index);
      }}
      onClick={() => {
        openFolder(name);
      }}
      className={`flex h-9 cursor-default items-center gap-2.5 rounded-lg px-3 text-[13px] text-droid-text [contain-intrinsic-size:auto_36px] [content-visibility:auto] ${
        index === active ? 'bg-droid-active' : ''
      }`}
    >
      <Folder size={15} aria-hidden className="shrink-0 text-droid-text-muted" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight
        size={14}
        aria-hidden
        className={`shrink-0 text-droid-text-muted ${index === active ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  ));
}

const SKELETON_WIDTHS = ['w-32', 'w-24', 'w-40', 'w-28', 'w-36', 'w-20', 'w-32'];

function SkeletonRows() {
  return (
    <div role="status" aria-label="Loading folders" className="space-y-1 pt-1">
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex h-9 items-center gap-2.5 px-3">
          <span className="skeleton-block h-4 w-4" />
          <span className={`skeleton-block h-3 ${width}`} />
        </div>
      ))}
    </div>
  );
}

export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded bg-droid-elevated px-1 py-px font-sans text-[10px] text-droid-text-secondary">
        {keys}
      </kbd>
      {label}
    </span>
  );
}
