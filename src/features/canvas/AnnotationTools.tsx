// The rail's annotation group: Draw, Shapes, Text and Note, each with its key,
// and beside the rail while a tool is armed or a mark is selected, the shape
// to draw and the colour to draw it in. The colours are the canvas's token
// names, painted from the theme.

import { useState } from 'react';
import { PenLine } from '@droidex/icons';
import type { AnnotationColor } from './annotationProtocol';
import { isShapeTool, type AnnotationTool, type ShapeTool } from './annotationGeometry';
import { Tool } from './BoardControls';

const COLORS: { color: AnnotationColor; label: string }[] = [
  { color: 'ink', label: 'Ink' },
  { color: 'red', label: 'Red' },
  { color: 'orange', label: 'Orange' },
  { color: 'yellow', label: 'Yellow' },
  { color: 'green', label: 'Green' },
  { color: 'blue', label: 'Blue' },
  { color: 'violet', label: 'Violet' },
];

const SHAPES: { tool: ShapeTool; label: string; key: string; glyph: string }[] = [
  {
    tool: 'rect',
    label: 'Rectangle',
    key: 'R',
    glyph: 'M6.5 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  },
  {
    tool: 'ellipse',
    label: 'Ellipse',
    key: 'O',
    glyph: 'M20 12a8 6.5 0 1 1-16 0a8 6.5 0 1 1 16 0Z',
  },
  { tool: 'line', label: 'Line', key: 'L', glyph: 'M5 19 19 5' },
  { tool: 'arrow', label: 'Arrow', key: 'A', glyph: 'M5 19 19 5M10.5 5H19v8.5' },
];

const TEXT_GLYPH = 'M6 6.5h12M12 6.5v12M9.5 18.5h5';
const NOTE_GLYPH = 'M5.5 5.5h13v8l-5 5h-8ZM13.5 18.5v-5h5';

export interface AnnotationToolsProps {
  tool: AnnotationTool | null;
  color: AnnotationColor;
  /** A tool is armed or a mark selected, so a colour has something to apply to. */
  showColors: boolean;
  onTool: (tool: AnnotationTool | null) => void;
  onColor: (color: AnnotationColor) => void;
}

export function AnnotationTools({
  tool,
  color,
  showColors,
  onTool,
  onColor,
}: AnnotationToolsProps) {
  // Shapes arms the shape drawn last, which its keys can change.
  const [lastShape, setLastShape] = useState<ShapeTool>('rect');
  if (isShapeTool(tool) && tool !== lastShape) setLastShape(tool);
  const shape = SHAPES.find((entry) => entry.tool === lastShape) ?? SHAPES[0];
  const toggle = (next: AnnotationTool) => {
    onTool(tool === next ? null : next);
  };
  return (
    <>
      <div role="group" aria-label="Annotate" className="canvas-rail-group">
        <Tool
          label="Draw"
          tip="Draw  P"
          pressed={tool === 'draw'}
          onClick={() => {
            toggle('draw');
          }}
        >
          <PenLine className="h-4 w-4" aria-hidden />
        </Tool>
        <Tool
          label="Shapes"
          tip={`${shape.label}  ${shape.key}`}
          pressed={isShapeTool(tool)}
          onClick={() => {
            onTool(isShapeTool(tool) ? null : shape.tool);
          }}
        >
          <Glyph path={shape.glyph} />
        </Tool>
        <Tool
          label="Text"
          tip="Text  T"
          pressed={tool === 'text'}
          onClick={() => {
            toggle('text');
          }}
        >
          <Glyph path={TEXT_GLYPH} />
        </Tool>
        <Tool
          label="Note"
          tip="Note  N"
          pressed={tool === 'note'}
          onClick={() => {
            toggle('note');
          }}
        >
          <Glyph path={NOTE_GLYPH} />
        </Tool>
      </div>

      {showColors && (
        <div className="canvas-tool-options">
          {isShapeTool(tool) && (
            <>
              <div role="group" aria-label="Shape" className="canvas-tool-options-group">
                {SHAPES.map((entry) => (
                  <button
                    key={entry.tool}
                    type="button"
                    title={`${entry.label}  ${entry.key}`}
                    aria-label={entry.label}
                    aria-pressed={tool === entry.tool}
                    className="canvas-tool"
                    onClick={() => {
                      onTool(entry.tool);
                    }}
                  >
                    <Glyph path={entry.glyph} />
                  </button>
                ))}
              </div>
              <span aria-hidden className="canvas-rail-divider" />
            </>
          )}
          <div role="group" aria-label="Colour" className="canvas-tool-options-group">
            {COLORS.map((entry) => (
              <button
                key={entry.color}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                aria-pressed={color === entry.color}
                className="canvas-tool"
                onClick={() => {
                  onColor(entry.color);
                }}
              >
                <span
                  aria-hidden
                  className="canvas-swatch"
                  style={{ background: `var(--droid-annotation-${entry.color})` }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" aria-hidden>
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
