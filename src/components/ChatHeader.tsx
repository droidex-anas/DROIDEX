import { Suspense } from 'react';
import { ChevronRight } from 'lucide-react';
import { Square } from '@droidex/icons';
import { Button } from './ui/Button';
import { TitleSweep } from './ui/TitleSweep';
import { LazyAttachedChatsMenu } from '../lib/lazySurfaces';
import { CloseTileButton, type TileChrome } from '../features/tabs/TileChrome';
import { tileHandleProps } from '../features/tabs/tileDrag';

interface ChatHeaderSub {
  label: string;
  meta?: string;
  running: boolean;
  backTitle?: string;
  onBack: () => void;
  onStop?: () => void;
}

function ChatTitleText({ title, live }: { title: string; live: boolean }) {
  return (
    <TitleSweep
      title={title}
      className={`block truncate text-body-strong ${live ? 'shimmer-text' : 'text-primary'}`}
    />
  );
}

/**
 * The chat's name in its header: a crumb back to the chat that owns a child
 * session, the attached-chats menu once this chat has a canvas on screen, or
 * plain text.
 */
function HeaderTitle({
  title,
  live,
  sub,
  canvas,
}: {
  title: string;
  live: boolean;
  sub: ChatHeaderSub | undefined;
  canvas: { appSessionId: string; canvasId: string } | undefined;
}) {
  if (sub)
    return (
      <button
        type="button"
        onClick={sub.onBack}
        title={sub.backTitle ?? 'Back to primary session'}
        className="truncate text-body-strong text-muted transition-colors hover:text-primary max-w-48"
      >
        {title}
      </button>
    );
  if (canvas)
    return (
      <Suspense fallback={<ChatTitleText title={title} live={live} />}>
        <LazyAttachedChatsMenu
          appSessionId={canvas.appSessionId}
          canvasId={canvas.canvasId}
          title={title}
          live={live}
        />
      </Suspense>
    );
  return <ChatTitleText title={title} live={live} />;
}

export function ChatHeader({
  title,
  live,
  sub,
  leadPx,
  trailPx,
  canvas,
  tile,
}: {
  title: string;
  live: boolean;
  sub?: ChatHeaderSub;
  // Room left at the row's start for the window controls and the sidebar
  // toggle while the sidebar is collapsed.
  leadPx: number;
  // Room left at the row's end for the session controls floating over it.
  trailPx: number;
  // The chat's own canvas, which turns the title into its attached-chats menu.
  canvas?: { appSessionId: string; canvasId: string };
  // In a split tab the title is the tile's drag handle and close button.
  tile: TileChrome | undefined;
}) {
  return (
    <div
      // Only the top row of tiles is the window's drag row.
      data-electron-drag-region={tile && !tile.atTop ? undefined : true}
      className="shrink-0 flex items-center gap-2 h-9"
      style={{ paddingLeft: leadPx, paddingRight: trailPx }}
    >
      {/* The title's text starts on the content edge and its padding hangs into
          the gutter, where a tile's drag handle lights up on hover. */}
      <div
        {...(tile ? tileHandleProps(tile.id) : {})}
        className={`-ml-1 flex h-control-sm min-w-0 items-center gap-1.5 rounded-md px-2 ${
          tile
            ? 'no-drag cursor-grab transition-colors hover:bg-elevated active:cursor-grabbing'
            : ''
        } ${tile && !tile.focused ? 'opacity-60' : ''}`}
      >
        <HeaderTitle title={title} live={live} sub={sub} canvas={canvas} />
        {sub && (
          <>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted/50" />
            <span
              className={`truncate text-body-strong max-w-48 ${sub.running ? 'shimmer-text' : 'text-primary'}`}
            >
              {sub.label}
            </span>
            {sub.meta && <span className="shrink-0 text-caption text-muted">{sub.meta}</span>}
          </>
        )}
        {tile && <CloseTileButton tileId={tile.id} title={title} />}
      </div>
      {sub?.onStop && (
        <Button size="sm" icon={Square} onClick={sub.onStop} title="Stop child session">
          Stop
        </Button>
      )}
    </div>
  );
}
