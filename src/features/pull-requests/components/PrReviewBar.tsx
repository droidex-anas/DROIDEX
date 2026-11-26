import { Button } from '../../../components/ui/Button';
import { Octicon } from '../../../components/environment/GithubIcons';

// The review handoff bar: floats above the diff while the reader has notes,
// and turns the whole set into a seeded Droid chat in one click. Clearing is
// deliberate and named, never part of the primary action.
export function PrReviewBar({
  count,
  onSend,
  onClear,
}: {
  count: number;
  onSend: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="pr-note-enter pointer-events-auto flex items-center gap-2 rounded-xl bg-raised px-2 py-1.5 shadow-lg">
        <span className="px-1 text-body-strong text-primary tabular-nums">
          {count} {count === 1 ? 'note' : 'notes'}
        </span>
        <Button variant="ghost" size="sm" onClick={onClear} title="Discard every note">
          Clear
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSend}
          title="Open a Droid chat with these notes"
        >
          <span className="inline-flex items-center gap-1.5">
            <Octicon name="comment-discussion" size={13} />
            Send to Droid
          </span>
        </Button>
      </div>
    </div>
  );
}
