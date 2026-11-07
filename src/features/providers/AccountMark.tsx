import type { DroidProfile } from '../../types/bridge';
import { cn } from '../../components/ui/cn';
import { DROID_PROFILE_LOGINS } from './providerIdentity';

// The extra Factory login a Droid chat runs on; Main, the default, wears none.
export function AccountMark({
  profile,
  className,
}: {
  profile: DroidProfile | undefined;
  className?: string;
}) {
  if (!profile) return null;
  const { label } = DROID_PROFILE_LOGINS[profile];
  return (
    <span
      className={cn('shrink-0 text-caption text-muted', className)}
      title={`${label} Factory account`}
    >
      <span className="sr-only">Factory account: </span>
      {label}
    </span>
  );
}
