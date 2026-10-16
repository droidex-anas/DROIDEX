import type { CSSProperties } from 'react';
import type { Components } from 'react-markdown';

// GFM only knows left, center and right; the hast type also allows values
// HTML tables never produce here.
function alignStyle(align: string | undefined): CSSProperties | undefined {
  return align === 'left' || align === 'center' || align === 'right'
    ? { textAlign: align }
    : undefined;
}

// GFM tables for the chat and spec presentations. A table wider than its column
// scrolls inside its own frame instead of stretching the transcript: the frame
// is capped at the available width, and a body cell never narrows past ~14
// characters, so a wide table scrolls instead of stacking its prose one word per
// line. With the scrollbar only shown on hover, the edge the table continues past
// fades instead, so a clipped table never reads as complete. The frame and its
// header separate by tone; only the dense body rows keep a divider.
export function markdownTableComponents(specMode: boolean): Components {
  const cell = specMode ? 'px-3.5 py-2.5' : 'px-2.5 py-1.5';
  return {
    table: ({ children }) => (
      <div
        className={`max-w-full overflow-hidden rounded-lg bg-surface ${specMode ? 'my-6' : 'my-2.5'}`}
      >
        <div className="scrollbar-on-hover scroll-fade-x overflow-x-auto overscroll-x-contain">
          {/* Row dividers only draw on <tr> when borders collapse. */}
          <table className="min-w-full text-body" style={{ borderCollapse: 'collapse' }}>
            {children}
          </table>
        </div>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-elevated">{children}</thead>,
    tbody: ({ children }) => (
      <tbody className="divide-y divide-divider [&_tr:hover]:bg-elevated/50">{children}</tbody>
    ),
    th: ({ children, align }) => (
      <th
        style={alignStyle(align)}
        className={`text-left align-top text-body-strong whitespace-nowrap text-primary ${cell}`}
      >
        {children}
      </th>
    ),
    td: ({ children, align }) => (
      <td
        style={alignStyle(align)}
        className={`min-w-28 align-top text-secondary first:font-medium first:text-primary ${cell}`}
      >
        {children}
      </td>
    ),
  };
}
