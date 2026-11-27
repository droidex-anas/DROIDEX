import { ArrowUp } from '@droidex/icons';

import { Button } from '../../../components/ui/Button';

// The review handoff bar: floats above the diff while the reader has notes,
// and turns the whole set into a seeded Droid chat in one click. Clearing is
// deliberate and named, never part of the primary action.
export function PrReviewBar({
  count,
  onSend,
  onClear,
}: {
  count: number;
  // Null until the pull request has loaded; the notes wait for it.
  onSend: (() => void) | null;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="pr-note-enter pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-raised pr-1.5 pl-4 shadow-lg">
        <span className="mr-1 whitespace-nowrap text-body-strong text-primary tabular-nums">
          {count} {count === 1 ? 'note' : 'notes'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          shape="round"
          onClick={onClear}
          title="Discard every note"
        >
          Clear
        </Button>
        <Button
          variant="primary"
          size="sm"
          shape="round"
          icon={ArrowUp}
          disabled={!onSend}
          onClick={() => onSend?.()}
          title={onSend ? 'Open a Droid chat with these notes' : 'Waiting for the pull request'}
        >
          Send to Droid
        </Button>
      </div>
    </div>
  );
}
