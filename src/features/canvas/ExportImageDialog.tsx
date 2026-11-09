// Export image: the selected frame's revision on show, saved where the user
// chooses as a PNG at 1x, 2x or 3x, or as an SVG when the design is a single
// root `<svg>`. Main captures and writes the bytes; this only asks for them.

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { CanvasDialog } from './CanvasDialog';
import {
  CanvasImageError,
  exportCanvasImage,
  exportCanvasSvg,
  readCanvasVector,
} from './captureCanvasImage';
import type { RevisionRef } from './protocol';
import { SegmentedControl, type Segment } from './SegmentedControl';

type Scale = 1 | 2 | 3;
type Format = 'png' | 'svg';

const SCALES: Segment<Scale>[] = [
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
];
const FORMATS: Segment<Format>[] = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
];

export function ExportImageDialog({
  canvasId,
  revision,
  frameName,
  width,
  height,
  onClose,
}: {
  canvasId: string;
  revision: RevisionRef;
  frameName: string;
  /** The frame's size in CSS pixels, which 1x keeps. */
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [scale, setScale] = useState<Scale>(2);
  const [format, setFormat] = useState<Format>('png');
  const [isVector, setIsVector] = useState(false);
  const [pending, setPending] = useState(false);
  const exportRef = useRef<HTMLButtonElement>(null);
  const ended = useRef(new AbortController());
  const titleId = useId();

  useEffect(() => {
    let current = true;
    void readCanvasVector(canvasId, revision).then((vector) => {
      if (current) setIsVector(vector !== null && 'svg' in vector);
    });
    return () => {
      current = false;
    };
  }, [canvasId, revision]);

  useEffect(() => {
    const controller = ended.current;
    return () => {
      controller.abort();
    };
  }, []);

  const asSvg = isVector && format === 'svg';
  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      const saved = asSvg
        ? await exportCanvasSvg(canvasId, revision, frameName)
        : await exportCanvasImage(canvasId, revision, frameName, scale, ended.current.signal);
      if (ended.current.signal.aborted) return;
      if (saved) {
        toast.success(`Exported “${frameName}”.`);
        onClose();
        return;
      }
    } catch (failure) {
      if (ended.current.signal.aborted) return;
      toast.error(
        failure instanceof CanvasImageError ? failure.message : 'This image could not be exported.',
      );
    }
    setPending(false);
  };

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={pending ? null : onClose}
      initialFocus={exportRef}
      className="w-full max-w-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        aria-busy={pending}
        className="flex flex-col gap-3 p-5"
      >
        <div>
          <h2 id={titleId} className="text-heading text-primary">
            Export image
          </h2>
          <p className="mt-1 text-label font-normal leading-5 text-muted">
            {asSvg
              ? 'Saves the design as an SVG that keeps its shapes sharp at any size.'
              : `Saves the design as a ${String(width * scale)} × ${String(height * scale)} px PNG.`}
          </p>
        </div>
        {isVector && (
          <SegmentedControl
            label="Format"
            options={FORMATS}
            value={format}
            disabled={pending}
            onPick={setFormat}
          />
        )}
        {!asSvg && (
          <SegmentedControl
            label="Scale"
            options={SCALES}
            value={scale}
            disabled={pending}
            onPick={setScale}
          />
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={exportRef}
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={pending}
          >
            Export…
          </Button>
        </div>
      </form>
    </CanvasDialog>
  );
}
