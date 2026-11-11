import { useEffect, useRef, useState } from 'react';
import { PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { ModelIcon } from '../ModelIcon';
import { AGENTS } from './agents';
import { fitFigures, type Figure } from './stage';
import { createStageEngine, type StageEngine } from './stageEngine';

interface Size {
  width: number;
  height: number;
}

/** The right side of setup: the DROIDEX X and the agents' marks, drawn in dots that follow the flow. */
export function PixelStage({ figures }: { figures: readonly Figure[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const engine = useRef<StageEngine | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      setSize((current) =>
        current?.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = marksRef.current;
    if (!size || !canvas || !host) return;
    const created = createStageEngine(canvas, host, size.width, size.height);
    engine.current = created;
    return () => {
      created.stop();
      engine.current = null;
    };
  }, [size]);

  useEffect(() => {
    if (size) engine.current?.show(fitFigures(figures, size.width, size.height));
  }, [figures, size]);

  return (
    <div
      ref={boxRef}
      className="absolute inset-0"
      aria-hidden="true"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        engine.current?.point(event.clientX - rect.left, event.clientY - rect.top);
      }}
      onPointerLeave={() => {
        engine.current?.leave();
      }}
    >
      <canvas ref={canvasRef} className="block size-full" />
      <div ref={marksRef} hidden>
        {AGENTS.map((agent) => (
          <span key={agent} data-agent={agent}>
            <ModelIcon provider={PROVIDER_MARKS[agent]} size={24} />
          </span>
        ))}
      </div>
    </div>
  );
}
