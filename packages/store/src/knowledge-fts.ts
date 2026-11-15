// All three knowledge FTS cursors use the same join and object pre-filter.
export function knowledgeFtsSql(objectWhere: string): string {
  // Design: order by FTS5's hidden rank column, not the SELECT alias (#283).
  // Its default is bm25(), but it lets SQLite stream in rank order instead
  // of sorting every match into a temporary B-tree before the first row.
  return "SELECT s.id as id, s.content as content, bm25(semantic_memories_fts) as rank " +
    "FROM semantic_memories_fts JOIN semantic_memories s ON s.id = semantic_memories_fts.rowid " +
    "WHERE semantic_memories_fts MATCH ? AND s.valid_until IS NULL" + objectWhere +
    " ORDER BY semantic_memories_fts.rank";
}
