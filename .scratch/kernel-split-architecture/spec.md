# Kernel Split Architecture

Track the Step 3 kernel split: four deepening candidates implemented in seam order 1->2->4->3->5.

Seams (from atomcode-kernel-split-architecture research):
- Seam 1: SearchProvider contract (packages/retriever/src/contract.ts)
- Seam 2: RRF pure function (packages/retriever/src/rrf.ts)
- Seam 4: FTS5 external content table + triggers (packages/store/src/schema.sql)
- Seam 3: RetrieverPort + SessionStorePort (packages/kernel/src/ports.ts)
- Seam 5: CLI thin shell + composition root (apps/cli/src/commands/*.ts)

Candidates in implementation order:
1. Domain Schema (candidate 1) — typed TOML schema + deep-merge + validate
2. RRF pure function + SearchProvider contract (candidate 2, seam 1+2)
3. Session Store FTS5 schema (candidate 3, seam 4)
4. Kernel ports + Agent Runtime adapter (candidate 4, seam 3)
5. CLI composition root (seam 5)

Acceptance: compile + build + process liveness (node dist/index.js --version).