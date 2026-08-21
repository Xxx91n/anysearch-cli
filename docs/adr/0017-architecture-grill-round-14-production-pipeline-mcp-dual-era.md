# ADR-0017: Architecture Grill Round 14 — Production Pipeline & MCP Dual Era

### Status
Accepted

### Context

ADR-0016 completed temporal decoupling and pure function-ization. The codebase has 16 ADRs (all Accepted), 2453 lines of TypeScript, 171 passing assertions, but no production build pipeline (no dist/). The MCP server has never been packaged or tested outside tsx dev mode. 12 known debt items remain.

atomcode research (4 rounds, 61 sources total across Exa/Tavily/AnySearch):
- Round 1 (11 sources): MCP build strategy — Walking Skeleton / Tracer Bullet model confirmed. Perplexity MCP, Anthropic reference servers, context-mode all ship build pipeline first, iterate algorithms after. ansible-mcp-server is the anti-pattern (3 versions shipped, all crash on startup).
- Round 2 (14 sources): LLM init dedup — Seemann Composition Root + Ousterhout deep module + pi-agent-core official constructor pattern. ADR-0007 already answered kernel dependency on LLM SDK.
- Round 3 (17 sources): exports/files best practice — pnpm workspace symlink + exports two-layer resolution. All 3 production projects (Perplexity, SDK v2, context-mode) use exports->dist + files match + prepack.
- Round 4 (14 sources): MCP session lifecycle 2026-08 — 2026-07-28 spec is fully stateless. Stateles protocol, stateful applications. All production LLM MCP servers use process-level one-time init.
- Round 5 (19 sources): MCP era compatibility — Claude supports new spec, Codex HTTP opt-in, Cursor/Windsurf/OpenClaw still legacy. SDK v2 createMcpHandler defaults to dual era. No hand-written compat layer needed.

### Decision

**D1: Walking Skeleton (Pipeline First)**
Ship tsup build + MCP Inspector + npm pack --dry-run + fresh-dir npx test before any algorithm deepening. models undefined is a release blocker (ans_chat is the flagship tool). query_knowledge stub ships as-is (ADR-0006 deferral, fail-open). Algorithm deepening deferred to post-release, calibrated by real client traffic.

**D2: createLlmSession Deep Module**
Extract createLlmSession({ provider, model }) to packages/kernel/src/llm-init.ts as a deep module. One function, one return type, one error path. Encapsulates createModels -> setProvider -> getModel -> streamSimple.bind. No env reads in kernel. CLI/MCP/plugin three consumers share. PiAgentRuntimeOptions types tighten from any/unknown to pi-ai real types.

**D3: Lazy Session Cache (C+B Hybrid)**
createLlmSession lazily initialized on first ans_chat call, cached in buildServer closure. Environment variable changes trigger rebuild. Not per-call creation (50-100ms overhead in agent loop hot path, 5-10% tax). Not bare module-level singleton (Service Locator anti-pattern). Composition root holds factory, lazy singleton + injection.

**D4: Dual Era Compatibility**
No hand-written compatibility layer. SDK v2 createMcpHandler(factory, { legacy: stateless }) provides dual era by default. Same URL serves both eras: _meta envelope -> modern path, no envelope -> legacy path. Use ONE factory for both legs. Add conformance dual-version CI (2025-11-25, 2026-07-28).

**D5: Build Verification Gate**
Standard verification chain: tsup build -> MCP Inspector (stdio handshake + tools/list returns 5 tools) -> npm pack --dry-run (verify files whitelist) -> fresh-dir npx test (verify shebang + CJS interop). Matches Perplexity MCP and Anthropic reference server verification chains.

**D6: Internal Package Mode**
Internal packages (kernel/store/retriever, private:true) keep main/types pointing to ./src/index.ts (turbo internal packages mode). No build script, no dist. Apps (mcp/cli/plugin) get exports -> dist + files match + prepack build. turbo.json check removes ^build dependency. Two-class treatment: publishable vs internal.

**D7: SDK Upgrade Sequencing**

Review by: 2027-01-01 (owner: MCP owner) — Phase 2 (SDK v2 upgrade) must be complete before the v1 maintenance window closes (~2027-01). Superseded in part by ADR-0018.
Phase 1: v1 pipeline (build + verify + ship). Phase 2: SDK v2 upgrade (transport layer rewrite buildServer -> createMcpHandler factory). Phase 3: Algorithm deepening (createLlmSession extraction + models undefined fix). Serial: transport skeleton first, then handler internals. One dimension at a time.

**D8: exports/files Two-Class Treatment**
Publishable packages (apps/mcp, apps/cli, apps/plugin): exports point to dist + files match + prepack/prepare build script. Internal packages (packages/kernel, packages/store, packages/retriever): main/types point to ./src/index.ts, no exports needed for single-entry packages. Three donts: no exports->src with files->dist, no paths alias instead of workspace, no missing ./package.json or types in exports.

### Consequences

+ Production pipeline unblocks packaging and distribution (npx ans-mcp / npx ans).
+ createLlmSession eliminates 2x duplicated LLM init logic (chat.ts + server.ts already drifted).
+ Lazy session cache avoids 50-100ms per-call overhead in agent loop hot path.
+ Dual era compatibility covers all current MCP clients (Claude/Codex/Cursor/Windsurf/OpenClaw).
+ Internal package mode eliminates unnecessary build artifacts for private packages.
+ SDK upgrade sequencing prevents two-dimension merge conflicts (transport + handler).
- SDK v2 upgrade deferred to Phase 2 (v1 stateless mode covers stdio, which is the main path).
- conformance dual-version CI adds test infrastructure overhead (tracked as Phase 2 deliverable).
- query_knowledge remains stub until post-release algorithm deepening.

### atomcode Research Sources

Round 1 (11 sources): Stanza, AI Hero, modelcontextprotocol.io, Pete Hodgson, Kniberg, Perplexity MCP package.json, Anthropic reference servers DeepWiki, context-mode HN/blog, ansible-mcp-server issue #2788, Mark Erikson ESM lessons, esbuild #3637.
Round 2 (14 sources): ploeh 2011/2019, Ousterhout APOSD Stanford, pi-agent-core README, Clean Architecture ch.26, PrepStack, asadighi MCP package guide, HN monorepo discussions, Vercel AI SDK docs, Nader Dabit pi ecosystem, pi.dev migration, janmeppe/csruiliu APOSD notes.
Round 3 (17 sources): pnpm workspace docs, Node.js exports spec, TS official docs, colinhacks live types, turbo internal packages blog, Vercel best-practices, moonrepo guides, npm package-json docs, arethetypeswrong, dev.to exports map, LaunchDarkly tutorial, Perplexity/SDK v2/context-mode package.json (all original-fetch verified).
Round 4 (14 sources): SEP-2567, 2026-07-28 spec blog, TS SDK v2 docs, GitHub MCP server changelog/PR, InfoQ/HN community, Nango stateless guide, arXiv 2606.30317/2604.21816, Python SDK releasebot, pi-ai README, Google official blog, cyanheads source code.
Round 5 (19 sources): SEP-2567/2575, TS SDK v2 createMcpHandler source, Claude/Codex/Cursor/Windsurf/OpenClaw client status, GitHub MCP server dual-era PR, Cloudflare migration guide, Pondero migration, conformance suite, Microsoft agent-governance-toolkit, Go SDK bug fix PR #1051, Simon Willison, Victor Dibia, HN/Reddit community.