// The look of one segment in a row of choices, chosen or not, shared by the
// segmented controls and the side panel's tabs.

import { cn } from '../../components/ui/cn';

export function segmentClass(selected: boolean, padding: string): string {
  return cn(
    'relative flex h-full w-full min-w-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-quick ease-smooth-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default',
    // The pill sits inset in its track; its hit area takes the track's padding and gaps, so a 28px track is 28px to click.
    'after:absolute after:-inset-x-px after:-inset-y-0.5',
    padding,
    // Light rungs are too close in tone to mark the choice, so it lifts as a raised pill.
    selected
      ? 'bg-raised text-primary shadow-sm dark:bg-active dark:shadow-none'
      : 'text-muted hover:text-primary',
  );
}
