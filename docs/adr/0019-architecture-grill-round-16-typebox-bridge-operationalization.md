# ADR-0019: Architecture Grill Round 16 — TypeBox Bridge Operationalization & Validation Consolidation

### Status
Accepted. Amends ADR-0018 D3 (ADR-0018 stays Accepted; the bridge strategy is unchanged). ADR-0018 D3 carries the back-reference `Amended by ADR-0019`.

### Context

ADR-0018 D3 deferred the TypeBox → `fromJsonSchema` bridge behind the "v2 SDK in place" trigger. That trigger has fired: `@modelcontextprotocol/server ^2.0.0` is installed and shipping `fromJsonSchema` (verified in `dist/index.cjs` + `dist/index.d.mts`). Round-16 grill (three atomcode research passes + one ADR-governance pass) decided how the bridge actually lands: which side of the seam holds business validation, what file shape the composition layer takes, where the kernel-side schema set lives, what the test pyramid looks like, and how this round's decisions are recorded.

atomcode research verdicts driving this round:
- Bridge enablement is official & production-stable: SDK migration guide lists raw JSON Schema via `fromJsonSchema()` as Fix-ladder path 3; TypeBox maintainer rejected native Standard Schema (discussion #1152 + PR #1384 in 1.0.28) — `fromJsonSchema` is the one zero-rewrite channel; dialect 2020-12 (TypeBox native) matches MCP default.
- SDK source (`packages/server/src/server/mcp.ts`) proves raw JSON Schema objects cannot be passed to `registerTool` directly (inputSchema must be `StandardSchemaWithJSON | undefined`) — the bridge is *required*, not optional.
- Production MCP servers (cyanheads/obsidian-mcp-server, chrome-devtools-mcp >30k★, playwright-mcp >15k★, context7 >5k★) all place the registration loop/barrel in the **composition layer**; zero precedent for a kernel-exported tool registry.
- Validation location: AJV is bundled by the SDK (Node runtime auto-selected, cf-worker variant for Workers); business constraints expressed as JSON Schema keywords (`minLength`, `enum`, …) are enforced for free.
- ADR-recording practice (Nygard 2011 original verified via Wayback, adr-tools, Fowler bliki, AWS, GDS Way, Fuchsia RFC, k8s KEP): follow-through of a deferred trigger is a **new record with an `Amends` link**, bidirectional; the original ADR stays Accepted, only its Status area gains an append-only back-reference.

### Decision

**D1 (Enable bridge now):** `registerTool` for each of the 5 `ans_*` tools uses `fromJsonSchema(KernelToolSchema)`; schema source of truth moves to kernel (`Tool Schema Registry`). TypeBox `Static<>` types stay in kernel as the type surface; MCP layer keeps zero zod at the registration seam. Implementation is a follow-up implementation round, not this ADR.

**D2 (Per-tool Barrel Pattern for apps/mcp):** one `src/tools/<tool>.tool.ts` per tool exporting `{ name, description, inputSchema: fromJsonSchema(Kernel_X_Input), handler }`; `src/tools/index.ts` barrel array; `server.ts` runs a single `forEach(registerTool)`. Adding tool #6 = one new file + one barrel entry; kernel and assembly untouched. Kernel does NOT export any tool registry (zero industry precedent; would pierce ADR-0015 cleanroom).

**D3 (All business validation in TypeBox keywords):** enums, string lengths, numeric ranges live in kernel TypeBox schemas (`Type.Union`/`Type.Literal`, `minLength`/`maxLength`, …); AJV enforces them on the wire via the bridge. No zod double-wrap at the MCP layer, no handwritten checks inside handlers. Side note: `Type.Optional`/`Type.Union` get one real smoke pass during implementation (atomcode flagged as the only unverified interop edge).

**D4 (Three-layer test sampling, no exhaustive matrix):** one kernel unit case asserting schema keywords reject malformed input; one mcp `server.test.ts` case asserting AJV rejection surfaces through `registerTool`/`callTool`; one cli e2e happy path. No N×3 matrix — `fromJsonSchema` is a deterministic pure function already covered upstream.

**D5 (Recorded as this ADR, Amends ADR-0018 D3, bidirectional link):** ADR-0018 D3 Status area gains `Amended by ADR-0019 — round 16 operationalization (bridge enabled, validation consolidated); strategy unchanged.` ADR-0018 body/Decision untouched (immutable-ADR convention already asserted by ADR-0018 D6).

**D6 (Rejects):** (a) codemod kernel to zod — swallows zod v4 breaking changes for zero wire gain, kills `Static<>` assets; (b) kernel-side `toMcpTool()` helper — imports MCP SDK into kernel, violates ADR-0015; (c) kernel-exported tool registry — zero precedent; (d) `ir-schema.ts` as host file for tool schemas — wrong domain (that file is the L0 rolling-summary contract).

### Consequences

+ Kernel becomes the single source of truth for all 5 tool input schemas; zod disappears from the MCP registration seam; tool #6 cost is O(1).
+ ADR chain stays traversable forward and backward (adr-tools `Amends`/`Amended by` semantics).
- One structural refactor lands in implementation: split `apps/mcp/src/server.ts` (~280 lines, 5 inline registrations) into per-tool files; pure move, handler bodies unchanged.
- New ponytail debt: `Type.Optional`/`Type.Union` interop smoke against a real client is owed at implementation time.

### Research Sources (atomcode, this round)

- SDK source: `packages/server/src/server/mcp.ts` (`_createRegisteredTool`, `standardSchemaToJsonSchema`) — standard-only registration surface.
- SDK migration guide — `fromJsonSchema()` as documented Fix-ladder path; AJV/cf-worker validators bundled.
- TypeBox discussion #1152 + PR #1384 + changelog 1.0.x — native Standard Schema rejected/removed; bridge is the only path.
- Production seams: cyanheads/obsidian-mcp-server `src/mcp-server/tools/definitions/`, chrome-devtools-mcp `src/tools/*`, playwright-mcp tool arrays, context7 factory; 1mcp local gateway (`zodToInputSchema` util in composition layer).
- ADR governance: Nygard 2011 (Wayback-verified full text), adr-tools README (`Amends` link), Embedded Artistry walkthrough, Fowler bliki (2026-03-24), AWS Prescriptive Guidance, GDS Way, Fuchsia RFC process, Kubernetes KEP template.

### Implementation Audit Addendum (round 16 audit, 2026-08-22)

After b5178d8 landed, an audit pass + atomcode research (skill `atomcode-research`, serialized single call, concurrency=1) surfaced one deviation from the round-3 atomcode verdicts that motivated this ADR:

**Deviating detail** — The original `tool-json-schemas.ts` was a hand-written mirror of `tool-schemas.ts` (two parallel files, same keyword surface). atomcode's follow-up report cites industry evidence that dual-schema drift is a known MCP production failure mode (specmatic "MCP Servers Are Lying About Their Schemas" — GitHub/Postman/HF MCPs drifted on live wires; aident.ai blog — MCP TS SDK v1→v2 raw-shape vs ZodObject mismatch producing empty inputSchema);  no community standard helper package exists to sync two parallel schema files.

**Fix (D1 amendment in place)** — `packages/kernel/src/tool-json-schemas.ts` now *derives* `KernelJsonSchemas` from `KernelToolSchemas` via `JSON.parse(JSON.stringify(KernelToolSchemas[name]))` (the official TypeBox→JSON Schema serialization channel per TypeBox author KKonstantinov in MCP SDK issue #825: "TypeBox objects 'are' Json Schema"; `[Kind]` symbols are stripped by JSON serialization per issues #786/#987). The TypeBox source adds `additionalProperties: false` on each of the 5 schemas so the derived JSON keeps the closed-envelope shape the hand-written version had. Drift is now structurally impossible.

**Test reinforcement** — `packages/kernel/test/tool-schemas.test.ts` adds a per-tool `assert.deepEqual(KernelJsonSchemas[name], JSON.parse(JSON.stringify(KernelToolSchemas[name])))` assertion across the registry, closing the loop on the "single source" invariant the ADR now claims.

**New ponytail comment + debt note** — `packages/kernel/src/tool-json-schemas.ts` carries a `ponytail:`-style header explaining the JSON-round-trip choice and the research citation. `docs/ponytail-debt-ledger.md` drops the legacy "TypeBox registry relies on v2 bridge pending SDK v2 migration" row (obsolete after ADR-0018 D1 landed and b5178d8 implemented it) and adds a `Resolved` entry for the mirror-drift debt.

**Acceptance re-run after fix** — `turbo check` 3/3 (cli/mcp/plugin tsc clean), `turbo test` 6/6 (kernel 31 asserts incl. drift-mirror assert, mcp 9/9 AJV keyword signature, cli 9/9 e2e, plugin 16/16, store & retriever green), `turbo build` + `pnpm pack` × 3 (cli-0.0.0.tgz 9.88 MB / mcp-0.0.0.tgz 9.70 MB / plugin-0.0.0.tgz 8.42 KB), process smoke: mcp stdio "anysearch MCP server: stdio transport ready" (exit 0), cli `--help` exit 0, plugin `dist/server/index.cjs` `:33333/health` 200 `{"status":"ok",...}`.
