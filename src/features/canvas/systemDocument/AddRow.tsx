// A section's add row (spec §6): "+ Note" in every editable section and
// "+ Tokens" where the section holds token groups. It sits at the section's
// end, and in a hover form in the gap between two blocks. Images join a kit
// through the picker or a drop (spec §8), not through this row.

import { Plus } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';

/** What a section's add row offers. */
export interface AddOffers {
  note: boolean;
  group: boolean;
}

export function AddRow({
  offers,
  between = false,
  onAdd,
}: {
  offers: AddOffers;
  /** In the gap between two blocks: hidden until hovered or focused within. */
  between?: boolean;
  onAdd: (kind: 'note' | 'group') => void;
}) {
  const buttons = (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        aria-label={between ? 'Add a note here' : undefined}
        onClick={() => {
          onAdd('note');
        }}
      >
        Note
      </Button>
      {offers.group && (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          aria-label={between ? 'Add a token group here' : undefined}
          onClick={() => {
            onAdd('group');
          }}
        >
          Tokens
        </Button>
      )}
    </>
  );
  if (!between) return <div className="flex gap-1">{buttons}</div>;
  // The row fills the column's gap without adding to it: its negative margins
  // cancel its height, and the buttons show on hover or focus.
  return (
    <div className="group/add -my-3 flex h-6 items-center">
      <span className="ml-5 flex gap-0.5 opacity-0 transition-opacity duration-quick ease-out group-hover/add:opacity-100 group-focus-within/add:opacity-100">
        {buttons}
      </span>
    </div>
  );
}
