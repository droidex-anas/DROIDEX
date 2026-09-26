import { Rosette } from '@droidex/icons';

// A skill chip's rose Rosette; the label beside it keeps the skill blue.
export function SkillIcon({ className }: { className?: string }) {
  return <Rosette className={className} style={{ color: 'var(--droid-skill-mark)' }} />;
}
