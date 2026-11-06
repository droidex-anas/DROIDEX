import { createIcon } from './Icon.js';
import { Dot } from './Dot.js';

const FRAME = (
  <path d="M8 4h8c3.6 0 5 1.4 5 5v6c0 3.6-1.4 5-5 5H8c-3.6 0-5-1.4-5-5V9c0-3.6 1.4-5 5-5Z" />
);

export const PanelLeft = createIcon(
  'panel-left',
  <>
    {FRAME}
    <path d="M8.5 4v16" />
  </>,
);

export const PanelRight = createIcon(
  'panel-right',
  <>
    {FRAME}
    <path d="M15.5 4v16" />
  </>,
);

export const PanelBottom = createIcon(
  'panel-bottom',
  <>
    {FRAME}
    <path d="M8.5 15.5h7" />
  </>,
);

export const Columns = createIcon(
  'columns',
  <>
    {FRAME}
    <path d="M12 4v16" />
  </>,
);

export const Maximize = createIcon(
  'maximize',
  <>
    <path d="M14 4h6v6" />
    <path d="m20 4-6 6" />
    <path d="M10 20H4v-6" />
    <path d="m4 20 6-6" />
  </>,
);

export const Minimize = createIcon(
  'minimize',
  <>
    <path d="m20 4-6 6" />
    <path d="M14 4.5V10h5.5" />
    <path d="m4 20 6-6" />
    <path d="M10 19.5V14H4.5" />
  </>,
);

export const LayoutTemplate = createIcon(
  'layout-template',
  <>
    <rect x="3" y="4" width="18" height="6" rx="2.5" />
    <rect x="3" y="14" width="8" height="6" rx="2.5" />
    <rect x="15" y="14" width="6" height="6" rx="2.5" />
  </>,
);

export const Monitor = createIcon(
  'monitor',
  <>
    <rect x="3" y="4" width="18" height="12.5" rx="3" />
    <path d="M12 16.5V20" />
    <path d="M8 20h8" />
  </>,
);

export const Terminal = createIcon(
  'terminal',
  <>
    <path d="m5 7 5 5-5 5" />
    <path d="M12.5 17H19" />
  </>,
);

export const SquareTerminal = createIcon(
  'square-terminal',
  <>
    {FRAME}
    <path d="m8 9.5 3 3-3 3" />
    <path d="M12.5 15.5h3.5" />
  </>,
);

export const Server = createIcon(
  'server',
  <>
    <rect x="3" y="4" width="18" height="6.5" rx="2.5" />
    <rect x="3" y="13.5" width="18" height="6.5" rx="2.5" />
    <Dot cx={7} cy={7.25} />
    <Dot cx={7} cy={16.75} />
  </>,
);

export const Blocks = createIcon(
  'blocks',
  <>
    <rect x="14" y="3" width="7" height="7" rx="2.5" />
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H10v4.5h4.5v8a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 18.5Z" />
  </>,
);

export const Boxes = createIcon(
  'boxes',
  <>
    <path d="m8 5.5 4-2 4 2v4l-4 2-4-2Z" />
    <path d="m8 5.5 4 2 4-2" />
    <path d="M12 7.5v4" />
    <path d="m3.5 14.5 4-2 4 2v4l-4 2-4-2Z" />
    <path d="m3.5 14.5 4 2 4-2" />
    <path d="M7.5 16.5v4" />
    <path d="m12.5 14.5 4-2 4 2v4l-4 2-4-2Z" />
    <path d="m12.5 14.5 4 2 4-2" />
    <path d="M16.5 16.5v4" />
  </>,
);
/* ── the inspector's glyphs: flex alignment and justification, text alignment,
   border styles, and wrap, drawn for a row direction ── */

/** A small filled bar, as these glyphs draw the items a flex row holds. */
function bar(x: number, y: number, width: number, height: number) {
  return (
    <rect
      key={`${String(x)}-${String(y)}`}
      x={x}
      y={y}
      width={width}
      height={height}
      rx="1.2"
      fill="currentColor"
      stroke="none"
    />
  );
}

/** The line an alignment glyph sits its bars against. */
function guide(d: string) {
  return <path d={d} />;
}

export const AlignItemsStart = createIcon(
  'align-items-start',
  <>
    {guide('M3 4.5h18')}
    {bar(6.5, 6.5, 4.5, 8)}
    {bar(13, 6.5, 4.5, 5.5)}
  </>,
);

export const AlignItemsCenter = createIcon(
  'align-items-center',
  <>
    {guide('M3 12h18')}
    {bar(6.5, 8, 4.5, 8)}
    {bar(13, 9.5, 4.5, 5)}
  </>,
);

export const AlignItemsEnd = createIcon(
  'align-items-end',
  <>
    {guide('M3 19.5h18')}
    {bar(6.5, 10, 4.5, 8)}
    {bar(13, 12.5, 4.5, 5.5)}
  </>,
);

export const AlignItemsBaseline = createIcon(
  'align-items-baseline',
  <>
    {guide('M3 16.5h18')}
    {bar(6.5, 7.5, 4.5, 9)}
    {bar(13, 10.5, 4.5, 6)}
  </>,
);

export const AlignItemsStretch = createIcon(
  'align-items-stretch',
  <>
    {bar(6.5, 5, 4.5, 14)}
    {bar(13, 5, 4.5, 14)}
  </>,
);

/* Justify glyphs mark the container's edges, or its centre line, so where the
   items sit along the row reads at a glance, and the three distributions stay
   apart: two items at the edges, two inset, three evenly. */
export const JustifyStart = createIcon(
  'justify-start',
  <>
    {guide('M4 5v14')}
    {bar(6.5, 7.5, 3.5, 9)}
    {bar(11.5, 7.5, 3.5, 9)}
  </>,
);

export const JustifyCenter = createIcon(
  'justify-center',
  <>
    {guide('M12 4v16')}
    {bar(6.5, 7.5, 3.5, 9)}
    {bar(14, 7.5, 3.5, 9)}
  </>,
);

export const JustifyEnd = createIcon(
  'justify-end',
  <>
    {guide('M20 5v14')}
    {bar(9, 7.5, 3.5, 9)}
    {bar(14, 7.5, 3.5, 9)}
  </>,
);

export const JustifyBetween = createIcon(
  'justify-between',
  <>
    {guide('M4 5v14')}
    {guide('M20 5v14')}
    {bar(6, 7.5, 3.5, 9)}
    {bar(14.5, 7.5, 3.5, 9)}
  </>,
);

export const JustifyAround = createIcon(
  'justify-around',
  <>
    {guide('M4 5v14')}
    {guide('M20 5v14')}
    {bar(7.5, 7.5, 3, 9)}
    {bar(13.5, 7.5, 3, 9)}
  </>,
);

export const JustifyEvenly = createIcon(
  'justify-evenly',
  <>
    {guide('M4 5v14')}
    {guide('M20 5v14')}
    {bar(6.5, 7.5, 2.5, 9)}
    {bar(10.75, 7.5, 2.5, 9)}
    {bar(15, 7.5, 2.5, 9)}
  </>,
);

export const AlignCenter = createIcon(
  'align-center',
  <>
    <path d="M6 6h12" />
    <path d="M8.5 12h7" />
    <path d="M7 18h10" />
  </>,
);

export const AlignRight = createIcon(
  'align-right',
  <>
    <path d="M8 6h12" />
    <path d="M13 12h7" />
    <path d="M11 18h9" />
  </>,
);

export const AlignJustify = createIcon(
  'align-justify',
  <>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </>,
);

export const BorderSolid = createIcon('border-solid', <path d="M4 12h16" strokeWidth="2.5" />);

export const BorderDashed = createIcon(
  'border-dashed',
  <path d="M4 12h16" strokeWidth="2.5" strokeDasharray="4.5 3.5" />,
);

export const BorderDotted = createIcon(
  'border-dotted',
  <path d="M4 12h16" strokeWidth="2.5" strokeDasharray="0.5 3.5" />,
);

export const BorderDouble = createIcon(
  'border-double',
  <>
    <path d="M4 9h16" />
    <path d="M4 15h16" />
  </>,
);

export const NoWrap = createIcon(
  'no-wrap',
  <>
    <path d="M4 12h10.5" />
    <path d="m10.5 8 4 4-4 4" />
    <path d="M19 7v10" />
  </>,
);
