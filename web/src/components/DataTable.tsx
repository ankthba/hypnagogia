import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, i: number) => ReactNode;
  className?: string;
}

/** Table that scrolls horizontally inside its own container (never the page body). */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'no rows',
  rowClass,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  empty?: string;
  rowClass?: (row: T, i: number) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="text-slate-500">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={rowClass ? rowClass(r, i) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
