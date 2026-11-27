// What counts as a page body, in the forms the write path and the read path
// use. The SQL form is the single source; the JS predicate mirrors it.

export interface PageBodyRow {
  content: string | null;
}

/**
 * SQL expression: the row has a page body. `length` is the code-point length
 * SQLite already uses elsewhere, so "has body" means the same thing in SQL as
 * `hasPageBody` does in JS. Qualified with `r.content`, so it is safe in joins;
 * every query using it must alias `retrieval_results` as `r`.
 */
export const HAS_PAGE_BODY_EXPR = "(r.content IS NOT NULL AND length(r.content) > 0)";

/** SQL condition: the row has no page body (snippet-only tier). */
export const NO_PAGE_BODY_SQL = " AND NOT " + HAS_PAGE_BODY_EXPR;

/** True when the row carries a page body. The `fetched` flag is never the judge. */
export function hasPageBody(row: Pick<PageBodyRow, "content">): boolean {
  return typeof row.content === "string" && row.content.length > 0;
}
