import { X } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { formatChord } from '../../lib/shortcuts';

/** What a chat view knows about the tile it fills in a split tab. */
export interface TileChrome {
  id: string;
  focused: boolean;
  // Whether the tile touches the chat area's top and left edges, where the
  // window's drag row and controls sit.
  atTop: boolean;
  atLeft: boolean;
}

export function CloseTileButton({ tileId }: { tileId: string }) {
  const dispatch = useStoreDispatch();
  const chord = useStoreSelector((state) => state.shortcutBindings.closeTile);
  return (
    <button
      type="button"
      aria-label="Close tile"
      title={`Close tile (${formatChord(chord)})`}
      onClick={() => {
        dispatch({ type: 'CLOSE_TILE', tileId });
      }}
      className="-mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-active hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40"
    >
      <X className="h-3 w-3" />
    </button>
  );
}
