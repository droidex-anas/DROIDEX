import type { ReactNode } from 'react';
import { ChevronRight } from '@droidex/icons';

// A collapsible sidebar section label: text with a trailing chevron, no fill.
// The label brightens on hover; an optional trailing action (e.g. "+") sits
// outside the toggle so it never collapses the section.
export function SidebarSectionHeading({
  label,
  open,
  onToggle,
  count,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  // Shown only while folded, standing in for the hidden rows.
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 pb-1 pl-3 pr-2.5 pt-1">
      <h3 className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group/heading flex w-full cursor-pointer items-center gap-1 rounded-sm text-left text-label text-muted transition-colors hover:text-secondary"
        >
          <span className="truncate">{label}</span>
          <ChevronRight
            className={`size-icon-sm shrink-0 opacity-50 transition group-hover/heading:opacity-100 ${open ? 'rotate-90' : ''}`}
          />
          {!open && count !== undefined && (
            <span className="ml-auto text-caption tabular-nums opacity-70">{count}</span>
          )}
        </button>
      </h3>
      {action}
    </div>
  );
}
