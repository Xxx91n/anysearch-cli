// What counts as a page body, in the forms the write path and the read path
// use. The SQL form is the single source; the JS predicate mirrors it.

export interface PageBodyRow {
  content: string | null;
}

/**
 * SQL expression: the row has a page body. Only emptiness is judged; SQL
 * `length` counts code points and JS `content.length` counts UTF-16 units, so
 * do not turn either form into a length comparison. Qualified with `r.content`,
 * so every query using it must alias `retrieval_results` as `r`.
 */
export const HAS_PAGE_BODY_EXPR = "(r.content IS NOT NULL AND length(r.content) > 0)";

/** SQL condition: the row has no page body (snippet-only tier). */
export const NO_PAGE_BODY_SQL = " AND NOT " + HAS_PAGE_BODY_EXPR;

/** True when the row carries a page body. The `fetched` flag is never the judge. */
export function hasPageBody(row: Pick<PageBodyRow, "content">): boolean {
  return typeof row.content === "string" && row.content.length > 0;
}
