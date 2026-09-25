import { useState } from 'react';
import { ModelIcon } from '../ModelIcon';
import { SkillIcon } from '../icons/SkillIcon';
import { PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { faviconUrl } from '../../lib/linkPresentation';
import type { SkillInfo } from '../../types/bridge';

// Icons come from the desktop app's main process (the favicon protocol for a
// remote logo, the local-image protocol for one on disk); a renderer running
// without it has nowhere to ask.
const canLoadIcons = typeof window !== 'undefined' && 'droidControl' in window;

// Icons that failed this session, so a row scrolled back into view goes straight
// to its mark instead of flashing an empty box while the request fails again.
const missingIcons = new Set<string>();

const SLOT = 'h-4 w-4 shrink-0';

/** A command's own sigil, the way both harnesses write it. */
function CommandSigil({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center text-[13px] leading-none text-droid-text-muted/70 ${className}`}
    >
      /
    </span>
  );
}

/**
 * The mark a catalog row carries: the plugin's or app's own logo when the
 * harness publishes one, tinted by the brand colour it publishes with it;
 * otherwise the harness's own mark for what it owns, the skill glyph for a
 * skill, and the command's slash for a command. Never a stand-in letter tile.
 */
export function CatalogRowIcon({
  item,
  className = SLOT,
}: {
  item: SkillInfo;
  className?: string;
}) {
  const src = item.icon ? faviconUrl(item.icon) : null;
  const [missing, setMissing] = useState(
    () => !canLoadIcons || (src !== null && missingIcons.has(src)),
  );

  if (src !== null && !missing) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        decoding="async"
        className={`rounded object-contain ${className}`}
        // The brand colour is the harness's own data, in whatever notation it
        // chose, so the tint is mixed rather than built by appending alpha hex.
        style={
          item.brandColor
            ? {
                background: `color-mix(in srgb, ${item.brandColor} 12%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${item.brandColor} 35%, transparent)`,
              }
            : undefined
        }
        onError={() => {
          missingIcons.add(src);
          setMissing(true);
        }}
      />
    );
  }
  if (item.kind === 'command') return <CommandSigil className={className} />;
  if (item.kind === 'skill') return <SkillIcon className={className} />;
  return (
    <span aria-hidden className={`flex items-center justify-center ${className}`}>
      <ModelIcon provider={PROVIDER_MARKS[item.provider]} size={14} />
    </span>
  );
}
