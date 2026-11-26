// What counts as a page body, in both forms the write path needs: a predicate
// for loaded rows and the SQL guard for an UPDATE's WHERE clause. They live
// together so a change to one cannot silently drift from the other.

export interface PageBodyRow {
  content: string | null;
}

/** True when the row carries a page body. The `fetched` flag is never the judge. */
export function hasPageBody(row: Pick<PageBodyRow, "content">): boolean {
  return typeof row.content === "string" && row.content.length > 0;
}

/** SQL condition: the row has no page body (snippet-only tier). */
export const NO_PAGE_BODY_SQL = " AND (content IS NULL OR content = '')";
