import type { ReactNode } from 'react';
import { GroupLabel } from '../settingsKit';

/** A titled group of settings in one quiet card. */
export function BrowserSettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      {title && <GroupLabel>{title}</GroupLabel>}
      <div className="divide-y divide-droid-border/50 rounded-2xl border border-droid-border/80 bg-droid-surface">
        {children}
      </div>
    </section>
  );
}

/** A site's origin, its scheme quieter than its host, kept whole on hover. */
export function SiteOrigin({ origin }: { origin: string }) {
  const [scheme, host] = origin.split('://');
  return (
    <span title={origin} className="min-w-0 truncate text-[12px] text-droid-text">
      <span className="text-droid-text-muted">{scheme}://</span>
      {host}
    </span>
  );
}

/** A heading inside a card for a list that follows it. */
export function ListHeading({ label, description }: { label: string; description: string }) {
  return (
    <div className="px-4 pb-1.5 pt-3.5">
      <div className="text-[12px] font-medium text-droid-text-secondary">{label}</div>
      <p className="mt-0.5 text-[11px] leading-4 text-droid-text-muted">{description}</p>
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3.5 text-[11.5px] text-droid-text-muted">{children}</p>;
}
