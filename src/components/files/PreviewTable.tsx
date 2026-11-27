export const TABLE_ROW_LIMIT = 500;
export const TABLE_COL_LIMIT = 50;

export function PreviewTable({ rows }: { rows: string[][] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table
        // eslint-disable-next-line design-policy/design-tokens -- dense-row divide-y: table rows draw their divider only in the collapsed border model
        className="w-full border-collapse text-caption"
      >
        <tbody className="divide-y divide-divider">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className={rIdx === 0 ? 'bg-elevated/40 font-medium' : ''}>
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="break-words px-2 py-1 text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
