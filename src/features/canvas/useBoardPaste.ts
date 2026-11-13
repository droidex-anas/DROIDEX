// ⌘V on the board with SVG markup (Figma's Copy as SVG, a browser) or an .svg
// file. Main imports it as an owned asset, and a frame seeded from that asset
// draws it as source the board can pick.

import { useEffect, useRef, type RefObject } from 'react';
import { importPastedSvg } from '../../lib/desktop';
import { toast } from '../../lib/toast';
import { isBoardEditor } from './boardKeys';
import { canvasClient } from './canvasClient';
import { AUTO_DESIGN_SYSTEM, designSystemChoice } from './designSystemChoices';
import type {
  CanvasFrame,
  CreateFramesInput,
  CreateFramesResult,
  DesignSystemRef,
  OwnedAsset,
} from './protocol';

const SVG_ROOT =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s/>]/i;
const PASTED_NAME = 'Pasted SVG';
// The sidecar's CANVAS_LIMITS.maxFrameNameLength.
const MAX_NAME_LENGTH = 120;
const KEPT_AS_IMAGE = {
  too_large: 'is too large to edit as source',
  stylesheet: 'styles its shapes with CSS rules that can’t be written onto them',
} as const;

export interface PastedSvg {
  name: string;
  markup: () => Promise<string>;
}

/** The SVG a paste carries, as a file or as text whose root is `<svg>`, or null. */
export function pastedSvg(clipboard: {
  files: Iterable<File>;
  getData: (type: string) => string;
}): PastedSvg | null {
  const file = [...clipboard.files].find(
    (each) => each.type === 'image/svg+xml' || /\.svg$/i.test(each.name),
  );
  if (file) {
    const name = file.name
      .replace(/\.svg$/i, '')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    return { name: name || PASTED_NAME, markup: () => file.text() };
  }
  for (const type of ['image/svg+xml', 'text/plain']) {
    const text = clipboard.getData(type);
    if (SVG_ROOT.test(text)) return { name: PASTED_NAME, markup: () => Promise.resolve(text) };
  }
  return null;
}

/** The board a paste lands on, as it was when the paste began. */
export interface PasteBoard {
  canvasId: string;
  /** False once the board has moved to another canvas or closed. */
  isCurrent: () => boolean;
  beside: CanvasFrame | undefined;
  designSystem: DesignSystemRef;
  importSvg: (canvasId: string, markup: string) => Promise<OwnedAsset>;
  createFrames: (input: CreateFramesInput) => Promise<CreateFramesResult>;
  focusFrame: (designId: string) => void;
}

/** Imports the SVG, then creates its frame, unless the board moved on in between. */
export async function placePastedSvg(svg: PastedSvg, board: PasteBoard): Promise<void> {
  let created: CreateFramesResult;
  try {
    const markup = await svg.markup();
    if (!board.isCurrent()) return;
    const asset = await board.importSvg(board.canvasId, markup);
    // An imported asset no frame refers to is harmless.
    if (!board.isCurrent()) return;
    created = await board.createFrames({
      mutationId: crypto.randomUUID(),
      ...(board.beside ? { placeBeside: { designId: board.beside.designId } } : {}),
      frames: [
        {
          name: svg.name,
          width: asset.width,
          height: asset.height,
          designSystem: board.designSystem,
          seed: { kind: 'svg', assetId: asset.assetId },
        },
      ],
    });
  } catch (error) {
    if (board.isCurrent()) toast.error(`Couldn’t paste the SVG. ${failureMessage(error)}`);
    return;
  }
  const frame = created.frames.at(0);
  if (!frame || !board.isCurrent()) return;
  board.focusFrame(frame.designId);
  const reason = created.svgAsImage?.find((entry) => entry.designId === frame.designId)?.reason;
  if (reason)
    toast.info(`${frame.name} was placed as an image because it ${KEPT_AS_IMAGE[reason]}.`);
}

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error)
    if (typeof error.message === 'string' && error.message) return error.message;
  return 'Canvas could not finish that request.';
}

/** The board area's paste handling, while it holds focus; a chat not attached to the canvas cannot add frames to it. */
export function useBoardPaste(
  boardArea: RefObject<HTMLElement | null>,
  paste: {
    appSessionId: string;
    canvasId: string;
    attached: boolean;
    beside: CanvasFrame | undefined;
    focusFrame: (designId: string) => void;
  },
): void {
  const latest = useRef(paste);
  useEffect(() => {
    latest.current = paste;
  });

  const { canvasId } = paste;
  useEffect(() => {
    // Cleared when the board leaves this canvas, so a paste begun before then lands nowhere.
    let isCurrent = true;
    // A paste on a focused element that is not editable goes to wherever the
    // text selection is, so the board's own focus decides, not the event's target.
    const onPaste = (event: globalThis.ClipboardEvent) => {
      const { appSessionId, attached, beside, focusFrame } = latest.current;
      const focused = document.activeElement;
      const area = boardArea.current;
      if (!attached || event.defaultPrevented || !event.clipboardData) return;
      if (!focused || !area?.contains(focused) || isBoardEditor(focused)) return;
      const svg = pastedSvg(event.clipboardData);
      if (!svg) return;
      event.preventDefault();
      void placePastedSvg(svg, {
        canvasId,
        isCurrent: () => isCurrent,
        beside,
        designSystem:
          designSystemChoice(canvasId)?.ref ?? beside?.designSystem ?? AUTO_DESIGN_SYSTEM.ref,
        importSvg: importPastedSvg,
        createFrames: (input) => canvasClient.createFrames(appSessionId, canvasId, input),
        focusFrame,
      });
    };
    document.addEventListener('paste', onPaste);
    return () => {
      isCurrent = false;
      document.removeEventListener('paste', onPaste);
    };
  }, [boardArea, canvasId]);
}
