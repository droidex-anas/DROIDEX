// The document's top row (spec §5): Back to the board, the kit's name, its
// version history and whose it is on the left; the caller's controls on the
// right. DocumentNotice is the quiet line under it for a kit that is read-only,
// and OlderVersionNotice that line over an older version.

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft } from '@droidex/icons';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { pushToast } from '../../../lib/toast';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import type { DesignSystemDocumentView } from '../protocol';
import { InlineField } from './InlineField';
import { UnsavedMark } from './UnsavedMark';
import { useIsMounted } from './useIsMounted';
import { VersionMenu } from './VersionMenu';

const MAX_NAME_LENGTH = 120;

/**
 * What the header keeps as its row narrows. It drops, in order, the
 * Preset/Yours badge, the mode toggle's words, the Board and Sections labels,
 * most of the primary action's label and last the version button; the name
 * truncates throughout. Widths are the row's content box, chosen so the row
 * never overflows with every control present.
 */
export interface HeaderRoom {
  badge: boolean;
  modeWords: boolean;
  navWords: boolean;
  fullPrimary: boolean;
  version: boolean;
}

function headerRoom(widthPx: number): HeaderRoom {
  return {
    badge: widthPx >= 720,
    modeWords: widthPx >= 640,
    navWords: widthPx >= 560,
    fullPrimary: widthPx >= 440,
    version: widthPx >= 340,
  };
}

export function DocumentHeader({
  view,
  name,
  onRename,
  onBack,
  onShowVersion,
  children,
}: {
  view: DesignSystemDocumentView;
  /** The draft's name, which may differ from the shown version's. */
  name: string;
  /** Null for a kit that cannot be edited. */
  onRename: ((name: string) => void) | null;
  onBack: () => void;
  onShowVersion: (version: number) => void;
  /** The right end: sections, mode, more menu and the primary action. */
  children: (room: HeaderRoom) => ReactNode;
}) {
  const headerRef = useRef<HTMLElement>(null);
  const room = headerRoom(useContentWidth(headerRef));
  const renamed = name !== view.name;
  return (
    <header
      ref={headerRef}
      className="design-system-document-header flex h-12 shrink-0 items-center gap-2 px-4"
    >
      {/* Board's padding hangs, so its arrow starts on the edge the notice and a narrow column share. */}
      {room.navWords ? (
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="-ml-2.5">
          Board
        </Button>
      ) : (
        <Tooltip label="Board" placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            aria-label="Board"
            onClick={onBack}
            className="-ml-1.5"
          />
        </Tooltip>
      )}
      {/* The margin keeps the unsaved dot's place between Board and the name. */}
      <div className="relative ml-3.5 flex min-w-0 items-center">
        <UnsavedMark
          mark={renamed ? 'changed' : undefined}
          was={renamed ? `Was ${view.name}` : undefined}
        />
        {onRename ? (
          <InlineField
            value={name}
            label="Design system name"
            check={(text) =>
              text.length > 0 && text.length <= MAX_NAME_LENGTH
                ? null
                : 'A name is 1 to 120 characters.'
            }
            onCommit={onRename}
            className="text-body-strong text-primary"
          />
        ) : (
          <h1 className="truncate text-body-strong text-primary">{name}</h1>
        )}
      </div>
      {room.version && <VersionMenu id={view.id} shown={view.version} onShow={onShowVersion} />}
      {room.badge && <Badge>{view.kind === 'preset' ? 'Preset' : 'Yours'}</Badge>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{children(room)}</div>
    </header>
  );
}

/** The primary action; short, it reads “Use” and names itself in full. */
export function UseInCanvas({ short, onUse }: { short: boolean; onUse: () => void }) {
  if (!short)
    return (
      <Button variant="primary" size="sm" onClick={onUse}>
        Use in this canvas
      </Button>
    );
  return (
    <Tooltip label="Use in this canvas" placement="bottom">
      <Button variant="primary" size="sm" aria-label="Use in this canvas" onClick={onUse}>
        Use
      </Button>
    </Tooltip>
  );
}

/** The element's width inside its padding, measured before paint and on every resize. */
function useContentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const style = getComputedStyle(element);
    setWidth(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

export function DocumentNotice({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-surface py-1.5 pl-4 pr-1.5">
      <p className="min-w-0 flex-1 truncate text-body text-secondary">{text}</p>
      {children}
    </div>
  );
}

/** Shown over an older version: back to the latest, or restore this one as the next. */
export function OlderVersionNotice({
  view,
  onShow,
}: {
  view: DesignSystemDocumentView;
  onShow: (target: number | 'latest') => Promise<void>;
}) {
  const [restoring, setRestoring] = useState(false);
  const isMounted = useIsMounted();

  const restore = async () => {
    setRestoring(true);
    try {
      await canvasClient.designSystems.restore(
        crypto.randomUUID(),
        view.id,
        view.version,
        view.latestVersion,
      );
      // Only while this version is on screen: the user may have moved on.
      if (isMounted()) await onShow('latest');
    } catch (error) {
      pushToast(canvasMessage(error), 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <DocumentNotice
      text={`Viewing v${String(view.version)} · latest is v${String(view.latestVersion)}`}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void onShow('latest');
        }}
      >
        Back to latest
      </Button>
      {view.kind === 'user' && (
        <Button
          variant="primary"
          size="sm"
          loading={restoring}
          disabled={restoring}
          onClick={() => {
            void restore();
          }}
        >
          Restore as v{view.latestVersion + 1}
        </Button>
      )}
    </DocumentNotice>
  );
}
