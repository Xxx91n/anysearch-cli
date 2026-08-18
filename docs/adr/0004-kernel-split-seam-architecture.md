# ADR-0004: Kernel Split Seam Architecture (Three Packages + Ports)

日期: 2026-08-18
状态: Accepted

## 背景 (Context)

The Step 3 kernel split (ADR-0001) requires deciding how to split the Retroaererd Engine into packages. atomcode research (atomcode-kernel-split-architecture) surveyed paperfoot search-cli, Exa, Perplexity, pi-mono, and OpenDev, identifying five seams from the deep-module vocabulary (codebase-design skill).

## 决策 (Decision)

Adopt the five-seam architecture from the research:

1. **Seam 1 — SearchProvider contract** (`packages/retriever/src/contract.ts`): All providers (Exa/Tavily/Brave/anysearch channel) implement one interface, return NormalizedResult. Two adapters justify the seam.
2. **Seam 2 — RRF pure function** (`packages/retriever/src/rrf.ts`): `rrfScores(lists, k=60)` is a pure function, no I/O. Tests without mocks. Formula: RRF_score(d) = sum_r 1/(k + rank_r(d)).
3. **Seam 4 — SessionStore FTS5** (`packages/store/src/`): SQLite+FTS5 external content table + triggers + bm25() ranking. Session isolation via session_id. WAL mode for CLI/MCP concurrency.
4. **Seam 3 — Kernel ports** (`packages/kernel/src/ports.ts`): RetrieverPort + SessionStorePort interfaces. Kernel only imports ports; CLI composition root injects implementations (dependency inversion).
5. **Seam 5 — CLI composition root** (`apps/cli/src/`): Thin shell — parse, assemble (inject provider registry + store), render (JSON envelope / table). Semantic exit codes 0-4 (paperfoot pattern).

Package layout:
```
packages/kernel/    -> Retroaererd Engine (agent loop, budget, sufficiency gate, tool dispatch)
packages/retriever/ -> SearchProvider adapters + RRF(k=60)
packages/store/     -> SQLite+FTS5 session store + domain schema
apps/cli/           -> thin shell + composition root
apps/mcp/           -> later: MCP stdio server reusing same kernel
```

Implementation order: seam 1 -> 2 -> 4 -> 3 -> 5 (bottom-up: leaf packages first, kernel ports next, CLI shell last).

## 备选方案 (Alternatives Considered)

1. **Four parallel git branches** (one per candidate): rejected — candidates 2 and 4 depend on the port interfaces from 1 and 3, so parallel branches would stub interfaces then rework them on merge. Single branch serial is shorter total diff.
2. **Single monolith package** (no split): rejected — the deletion test shows complexity would scatter across N callers; deep-module discipline requires seam-per-package.
3. **AI SDK runtime** (Vercel): rejected by ADR-0001 — pi-agent-core is the locked runtime. This ADR does not reopen that decision.

## 后果 (Consequences)

正面：
- Each package independently testable (9+8+5 tests pass with zero mocks for RRF).
- CLI and future MCP server share the same kernel via ports (dependency inversion).
- New providers added by implementing SearchProvider, not modifying kernel.
- Domain schema deep-merge (cc-persona transplant) is type-enforced, not doc-only convention.

负面：
- 5 workspace projects add turbo/pnpm coordination overhead (mitigated: already on turbo).
- TS SQLite binding (node:sqlite vs better-sqlite3 vs libsql) not yet validated — listed as research gap.
- FTS5 unicode61 tokenizer lacks Chinese segmentation — must test before Chinese-heavy sessions.

关联：ADR-0001 (TS + pi skeleton), ADR-0002 (domain authority TOML), ADR-0003 (Code Mode soft dependency).
*End of ADR-0004*