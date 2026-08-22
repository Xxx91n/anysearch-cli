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
