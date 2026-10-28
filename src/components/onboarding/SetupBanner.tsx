import { AlertTriangle, CircleArrowUp, X } from '@droidex/icons';
import { WINDOW_CONTROLS_INSET_PX } from '../../lib/windowChrome';
import { Button } from '../ui/Button';

export type SetupBannerKind = 'blocker' | 'update';

export default function SetupBanner({
  kind,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  kind: SetupBannerKind;
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
}) {
  const Icon = kind === 'blocker' ? AlertTriangle : CircleArrowUp;
  const accent = kind === 'blocker' ? 'text-warning' : 'text-accent';
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-2 bg-elevated pr-2 text-body"
      style={{ paddingLeft: WINDOW_CONTROLS_INSET_PX }}
    >
      <Icon className={`size-icon-sm shrink-0 ${accent}`} />
      <span className="truncate text-primary">{message}</span>
      <Button variant="primary" size="sm" onClick={onAction} className="ml-1">
        {actionLabel}
      </Button>
      <div className="flex-1" />
      {onDismiss && (
        <Button variant="ghost" size="sm" icon={X} aria-label="Dismiss" onClick={onDismiss} />
      )}
    </div>
  );
}
