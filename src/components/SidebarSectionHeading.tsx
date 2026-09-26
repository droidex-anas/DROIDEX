import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

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
          className="group/heading flex w-full cursor-pointer items-center gap-1 rounded-md text-left text-[13px] font-medium text-droid-text-muted transition-colors hover:text-droid-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40"
        >
          <span className="truncate">{label}</span>
          <ChevronRight
            className={`h-3 w-3 shrink-0 opacity-50 transition-[transform,opacity] group-hover/heading:opacity-100 ${open ? 'rotate-90' : ''}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          {!open && count !== undefined && (
            <span className="ml-auto text-[11px] font-normal tabular-nums opacity-70">{count}</span>
          )}
        </button>
      </h3>
      {action}
    </div>
  );
}
