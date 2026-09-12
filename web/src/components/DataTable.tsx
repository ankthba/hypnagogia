import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fmtInt } from '../lib/format';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, i: number) => ReactNode;
  className?: string;
}

/**
 * Table that scrolls horizontally inside its own container (never the page body).
 *
 * `pageSize` paginates it. That is a rendering decision, never a data one: the control says how
 * many rows there are in total, every row is reachable, and "show all" is one click away. A
 * per-seed table here can be 160 rows of twelve cells, which is two thousand DOM nodes built during
 * the same commit as a 126,109-point map upload.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'no rows',
  rowClass,
  pageSize,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  empty?: string;
  rowClass?: (row: T, i: number) => string;
  /** show this many rows at a time, with a control for the rest; omit to render every row */
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);
  const paged = pageSize !== undefined && pageSize > 0 && !all && rows.length > pageSize;
  const nPages = paged ? Math.ceil(rows.length / pageSize) : 1;

  // A filter change (a different condition, a different seed) gives a shorter list; the page index
  // must not survive it and leave the reader looking at an empty table.
  useEffect(() => {
    setPage((p) => (p < nPages ? p : 0));
  }, [nPages]);

  const shown = useMemo(() => (paged ? rows.slice(page * pageSize!, page * pageSize! + pageSize!) : rows), [rows, paged, page, pageSize]);
  const offset = paged ? page * pageSize! : 0;

  return (
    <>
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
                <td colSpan={columns.length} className="muted">
                  {empty}
                </td>
              </tr>
            )}
            {shown.map((r, i) => (
              <tr key={rowKey(r, offset + i)} className={rowClass ? rowClass(r, offset + i) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(r, offset + i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize !== undefined && pageSize > 0 && rows.length > pageSize && (
        <div className="table-pager smaller">
          {all ? (
            <>
              <span className="muted">all {fmtInt(rows.length)} rows shown</span>
              <button type="button" className="control" onClick={() => setAll(false)}>
                show {fmtInt(pageSize)} at a time
              </button>
            </>
          ) : (
            <>
              <span className="muted tabular-nums">
                rows {fmtInt(offset + 1)} to {fmtInt(Math.min(offset + pageSize, rows.length))} of {fmtInt(rows.length)}
              </span>
              <span className="table-pager__buttons">
                <button type="button" className="control" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  previous
                </button>
                <button type="button" className="control" onClick={() => setPage((p) => Math.min(nPages - 1, p + 1))} disabled={page >= nPages - 1}>
                  next
                </button>
                {/* The widest table here is 122 rows of 27 columns, and building those 3,294 cells
                    in the click's own commit is a 260 ms freeze on a throttled CPU. As a
                    transition the click paints immediately and the rows arrive in a later,
                    interruptible commit, so the page never stops responding. */}
                <button type="button" className="control" onClick={() => startTransition(() => setAll(true))}>
                  show all
                </button>
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
