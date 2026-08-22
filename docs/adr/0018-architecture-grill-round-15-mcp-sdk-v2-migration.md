# ADR-0018: Architecture Grill Round 15 — MCP SDK v2 Migration Strategy

### Status
Accepted

### Context

ADR-0017 completed the production pipeline skeleton (Walking Skeleton + dual-era foundation + lazy caches). atomcode research (8 serialized rounds, ~70 unique sources across Exa/Tavily/AnySearch) deepened the Phase 2 (SDK v2 migration) strategy.

- Round 1 (Migration strategy): fastmcp #300 measured 442/448 codemod pass-through; Cloudflare//AWS/official guidance all direct-migrate when no sessionful deps.
- Round 2 (CI shape): conformance composite action input surface has no spec-version/requirements; typescript-sdk own CI runs CLI directly with two spec revisions.
- Round 3 (TypeBox->zod): typemap archived 2026-04-15 (npm deprecated); fromJsonSchema bridge is official zero-rewrite path.
- Round 4 (zod version gating): PR #1895 three-tier capability detection is the industry live sample.
- Round 5 (Trigger timing): B(6-month SDK window ~2027-01) + C(client matrix as risk input) + D(self-paced dual era) is the industrial consensus; A(passive default flip) does not exist by protocol design.
- Round 6 (Freeze window in ADR): Fowler/AWS/WhyChose/Nygard agree on immutable ADR with supersede; k8s/OTEP put lifecycle in separate policy doc.
- Round 7 (elicitation shim): zero usage in repo (rg confirms); legacy shim auto-on if introduced later.
- Round 8 (legacy drain): Cloudflare P6 — no sessionful deps means no legacy channel to drain; optional final step legacy:"stateless"->"reject" once client matrix is green.

### Decision

**D1 (Q1): codemod one-shot migration to v2**
Run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` in each publishable package root (apps/mcp, apps/plugin), then manual fixes only at `@mcp-codemod-error` markers. Keep `legacy: "stateless"` as the dual-era leg post-migration; no dual-source maintenance.

**D2 (Q2): conformance via CLI direct invocation + light e2e, not composite action**
`npx @modelcontextprotocol/conformance server --url <endpoint> --requirements 2025-11-25,2026-07-28` (or stdio variant). tier-check treated as governance signal only (issue #426 unresolved). e2e matrix cells: stdio + streamable HTTP legacy handshake; modern 2026-07-28 cell added when client matrix greens.

**D3 (Q3): dual-layer schema strategy — kernel via fromJsonSchema(TypeBox), apps via codemod + zod ^4.2.0**
packages/kernel keeps TypeBox schemas; register via `fromJsonSchema(TypeBoxSchema)` (zero rewrite, JSON Schema 2020-12 dialect aligned). apps/mcp/apps/plugin run codemod + lock zod `^4.2.0`. Both lanes converge at the MCP v2 registration surface; no forced merge of schema layers.

*Amended by ADR-0019 — round 16 operationalization (bridge enabled, validation consolidated); strategy unchanged.*

**D4 (Q4): capability detection, not version-string guard**
Guard on `~standard.jsonSchema` existence (PR #1895 pattern): zod 3.x => throw with upgrade instructions; zod 4.0-4.1 => fallback path with one-time console.warn (descriptions may drop); zod 4.2.0+ => native path. Install-time floor via `zod` dependency `^4.2.0` (not peer-dep; npm bypassable, pnpm multi-version).

**D5 (Q5): trigger timing = B(hard floor ~2027-01 SDK EOL) + C(client matrix as risk input) + D(self-paced dual era) — A(passive wait) rejected**
B sets the latest-must-migrate deadline (TS SDK README: v1.x bug/security fixes >= 6 months post 2026-07-28). C risk matrix (Claude Code v1/v2 runtime dual, Codex opt-in, others legacy) informs dual era depth. D dual-protocol parallel serves both eras until matrix flips.

**D6 (Q6): v1 freeze date lands in ADR as `Review by` clause + precise EOL in debt ledger — not a standalone Version Lifecycle ADR**
ADR-0008 Decision 5 and ADR-0017 D7 carry the decision-level time boundary; add `Review by: 2027-01-01 (owner: <MCP owner>)` to both. Precise EOL dates (2027-01, zod 4.2 pin rationale) go into docs/ponytail-debt-ledger.md with a `review-by` column. A separate Version Lifecycle ADR is rejected (immutable ADR convention + k8s/OTEP lifecycle-layering precedent).

**D7 (Q7): elicitation shim — no action**
rg confirms zero `elicitation`/`createMessage`/`input_required` usage across apps+packages. SDK v2 legacy shim auto-converts `input_required` to server->client push requests when needed (default on).

**D8 (Q8): legacy channel drain — no drain needed for anysearch-cli**
ADR-0008 D4 already set stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`, `keepAliveMs: 0`). All five Cloudflare sessionful-dependency triggers are absent. Migration is complete once v2 lands; optional final polish: flip `legacy: "stateless"` -> `legacy: "reject"` after client matrix is fully green.

### Consequences

+ Single migration wave with codemod as the workhorse (bounded effort, fastmcp#300 measured).
+ CI conformance via CLI guarantees spec-version coverage without composite action feature gaps.
+ Kernel TypeBox assets preserved (no Big Rewrite); fromJsonSchema is an official one-liner bridge.
+ Capability detection prevents silent description-loss and post-first-tools/list crashes.
+ Review-by dates hard-wire the v1 maintenance window into decision records.
- zod 4.0-4.1 fallback path still drops descriptions (tracked as known debt until consumers upgrade).
- No e2e modern-era cell until client matrix flips (tracked via D2).
- `legacy: "reject"` flip deferred until dual era traffic confirmed zero impact (D8).

### Review
- Review by: 2027-01-01 (owner: MCP owner) — reconfirm SDK v1 EOL posture; if maintenance extended, adjourn Review by.

### atomcode Research Sources

Rounds 1-8 (16+12+17+15+13+10+9+14 =~70 unique sources incl. official migration guides, typescript-sdk repo, Cloudflare agents guides, fastmcp #300, typebox#1152/typemap archived, zod#5714/#5719, PR #1895, SEP-2596 PR, endoflife.date/Renovate/GDS Way, WhyChose ADR checklist, joelparkarhenderson ADR repo, KEP/OTEP lifecycle docs, Cloudflare conformance docs/action.yml, InfoQ, aident.ai, Dev.to, HN).
