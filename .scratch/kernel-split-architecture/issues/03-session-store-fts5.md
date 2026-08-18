# 03: Session Store FTS5 schema (candidate 3, seam 4)

Implement:
- packages/store/src/schema.sql: FTS5 external content table + triggers + bm25() ranking
- packages/store/src/session-store.ts: SessionStore interface (save/search/resume)
- Session isolation via session_id

Reference: atomcode-kernel-split-architecture research (seam 4).
FTS5 content= mechanism avoids duplicate storage. WAL mode for CLI/MCP concurrency.