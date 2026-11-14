// The "Tag in chat" toggle beside a kit catalog entry, in the board's
// Components tab and in the kit document, as the frame toolbar's tag is beside
// a frame: it tags the entry in the chat's next prompt with the options shown
// beside it, or takes the tag off. Untagged, it shows on hover and focus.

import { Check, MessageThread } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';
import { Tooltip } from '../../components/ui/Tooltip';
import { useComponentPins, type ComponentPin } from './componentPins';
import { componentTag, TAG_TOOLTIPS, toggleComponentPin } from './componentTagging';

export function TagComponentButton({
  appSessionId,
  pin,
  shortcut,
  revealed = false,
  tabIndex,
  className,
}: {
  appSessionId: string;
  pin: ComponentPin;
  /** The key that toggles it while the keyboard stays elsewhere, shown in its tooltip. */
  shortcut?: string;
  /** Shown without hover, as on the row the keyboard is on. */
  revealed?: boolean;
  tabIndex?: number;
  className?: string;
}) {
  const tag = componentTag(useComponentPins(appSessionId), pin);
  const tooltip = TAG_TOOLTIPS[tag];
  return (
    <Tooltip label={shortcut ? `${tooltip}  ${shortcut}` : tooltip} className={className}>
      <Button
        variant="ghost"
        size="sm"
        icon={tag === 'tagged' ? Check : MessageThread}
        aria-label={`Tag ${pin.name} in the chat`}
        aria-pressed={tag === 'tagged'}
        tabIndex={tabIndex}
        className={cn(
          tag === 'untagged' &&
            !revealed &&
            'opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
        onClick={(event) => {
          event.stopPropagation();
          toggleComponentPin(appSessionId, pin);
        }}
      />
    </Tooltip>
  );
}
