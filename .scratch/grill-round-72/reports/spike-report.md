# R72 T0 Spike Report — DeepSeek Harness (dsh) host contract discovery

Stack: r72-grill (GitButler), pin `@deepseek-ai/dsh@0.1.5-rc.2`, isolated `$DSH_HOME`, headless profile, no LLM key required.

## Verdicts (9 probes)

| # | Probe | Verdict | Mechanism confirmed |
|---|-------|---------|---------------------|
| 1 | `tools/pre-execute` waterfall async serialization | **PASS** | Listener promise IS awaited: a 400 ms async gate returned `{kind:'deny'}` and the call materialized `isError:true` with the deny reason. First-party precedent: `dsh-hooks-claude-code` does `await runPoint(...)` then `next()`. Contract text: registry "never abandons their promise". |
| 2 | `agent.inject()` semantics | **PASS** | Injected `UserMessage` is durable AND admitted: durable log shows `agent/inbox/spliced` (target next-step) then `user/message` (surfaceOp append); wire request body places the injected user message before the task message. Late inject via `ctx.agents.list()[0].inject()` also lands durable. |
| 3 | `ctx.systemPrompt` registration | **PASS** | `.section()/.context()/.variable()` all return disposers; contributions appear in live `assemble()` output (18 sections/3 contexts) AND in the wire request body (section text + runtime-context snapshot). |
| 4 | Headless activation | **PASS** | `dsh --profile headless "<task>"` takes the prompt as positional arg, streams reasoning to stderr, prints final text to stdout, exits 0. All four event surfaces fire. Tax: apply→agent-created ≈ 1.2 s; MCP-bridged tools visible ≈ 3.5 s; full turn with real search ≈ 4.5 s. `patchReload: "startup"` (no live reload in headless). |
| 5 | `dsh plugin add` on Windows | **PASS** | `dsh plugin --profile headless add <dir>` forwards to system pnpm 11.24.0 (= our pin), installs as `link:` dep, and AUTO-APPENDS the package to `dsh.profile.bundles` in profile package.json — one-step install. Zero-dep package → zero pendingBuilds approval. Tarball path deferred to T2 (`pnpm pack` → `add <tgz>`). |
| 6 | `mcp__anysearch__*` naming | **PASS** | All five tools bridged as `mcp__anysearch__search_web`, `mcp__anysearch__research_web`, `mcp__anysearch__recall_memory`, `mcp__anysearch__query_knowledge`, `mcp__anysearch__ans_chat` — present in `ctx.tools.schemas()` (33 total), in the wire `tools[]` array, and invoked on-wire by the model. ALL FIVE match the existing `ANS_TOOL_PATTERN` (`ans_*` matcher) → existing hooks layer compatible unchanged. |
| 7 | `--dump-config` | **PASS** | `--dump-default-config` prints the shipped tree (348 lines, layer headers `# == @deepseek-ai/dsh-base`, patched-by markers) without booting. `--dump-config` additionally shows bundle + user patch layers. |
| 8 | **BLOCKING**: bundle patch replaces/inserts mcp-client row | **PASS** | Our zero-dep bundle's `cordis.patch.yml` `- insert:` added `{id: mcp-anysearch, name: '@deepseek-ai/dsh-mcp-client', config: {serverName: anysearch, transport: stdio, command: node, args: [apps/mcp/dist/index.cjs]}}`. Verified at config level (dump shows our layer) AND runtime level: bridge spawned the real ans-mcp server ("anysearch MCP server: stdio transport ready"), discovered all 5 tools, and a model-requested `mcp__anysearch__search_web` call executed the real search end-to-end (10 results, `isError:false`). |
| 9 | Whole-row replacement semantics | **PASS** | `id`-targeted patch replaces the row's whole `config` value (NOT merge): user-layer patch fully replaced `agent-default-model` config (provider+model repoint drove the stub turn) and gave `llm-pi-ai` its complete config. Our design INSERTS the mcp row (id absent in dsh-base) so nothing is clobbered; T1 must restate every key anyway per D-002. |

## Phase-2 go/no-go: **GO**

Blocking probe #8 passed at both config and runtime level. All nine probes PASS; zero FAIL, zero RESHAPE. Phase-1-only downgrade not needed.

## Evidence

| File | Contents |
|------|----------|
| `evidence/t0-boot4-e2e-clean-exit.log` | Decisive run: all PROBE lines + real `mcp__anysearch__search_web` result-observed + clean exit 0 |
| `evidence/t0-boot3-mcp-naming.log` | Naming discovery (async MCP sync lands ~4 s in) |
| `evidence/t0-boot2-missing-credential.log` | Fail-fast path (MISSING_CREDENTIAL) + ctx-inactive failure mode |
| `evidence/t0-llm-stub-requests.log` | Wire request bodies: injected user msg, PROBE section/context text, `mcp__anysearch__*` in tools[] |
| `evidence/t0-durable-session-events.txt` | Decoded zstd session events: inbox/spliced → user/message durability chain, tool/call + tool/result |
| `evidence/t0-dump-default-config.txt` / `t0-dump-config-with-bundle-and-user-patch.txt` | Config composition before/after bundle + user layers |
| `evidence/t0-probe-plugin/` | The zero-dep probe bundle source (package.json, cordis.patch.yml, lib/index.js) |
| `evidence/t0-llm-stub.mjs` | SSE-speaking OpenAI-compatible stub used to drive real turns |

Reproduction (sandbox layout; replace the first path if rebuilt elsewhere):

```bash
export DSH_HOME=/d/Aworker/dsh-r72-spike/home
export PROBE_STUB_KEY=probekey
node /d/Aworker/dsh-r72-spike/llm-stub.mjs &          # OpenAI-compat stub :28123
npx -y -p @deepseek-ai/dsh@0.1.5-rc.2 dsh plugin --profile headless add /d/Aworker/dsh-r72-spike/probe-plugin
npx -y -p @deepseek-ai/dsh@0.1.5-rc.2 dsh --profile headless "say hello"
```

The probe patch's mcp row points at repo-relative `apps/mcp/dist/index.cjs` (already built).

## Contract findings that shape T1

1. **Four surfaces confirmed**: `ctx.on('agent/session-start'|'tools/pre-execute'|'tools/post-execute'|'tools/result')`; `ctx.systemPrompt.section()/.context()/.variable()`; `ctx.tools.register()/.guard()/.schemas()`; `agent.inject(msg)`. `agent/session-start` is the documented inject mount point ("Use agent.inject() to seed model-facing context") — better than `agent/created` for memory injection.
2. **Plugin entry shape**: `export const name`, `export const inject = ['tools','systemPrompt','agents']`, `export function apply(ctx)` — `inject` orders activation after those services exist. Our probe used exactly this shape.
3. **Zero-dep viability CONFIRMED**: the probe carries zero runtime deps and zero `@deepseek-ai/*` imports; a hand-rolled `UserMessage` (`{id: uuid, role:'user', content:[{type:'text',text}], source:{kind:'plugin',plugin:<name>}}`) was accepted by `inject()` and landed durable. `@deepseek-ai/*` types remain devDep-only (compile-time churn alarm) — T1 needs NO runtime imports.
4. **Bundle install**: `dsh.bundle.patch` in package.json + auto-registration into `dsh.profile.bundles` on `dsh plugin add`. The bundle's patch `- insert:` list adds NEW rows (we insert `mcp-anysearch`; nothing replaced).
5. **Timing**: agent-created ≈1.2 s after apply; MCP discovery lands ~2–4 s in — preheat via `tools/pre-execute` on first ans_* call must not block startup; warm async.
6. **Deny contract**: `{kind:'deny', reason}` materializes an error result; `ask` needs an approval service (absent → denial) — URL policy uses `deny`. Monotonic `ctx.tools.guard()` exists as belt-and-suspenders but the awaited waterfall suffices.
7. **Post-execute knobs**: `{kind:'accept', content|value, additionalContexts}` or `{kind:'block', feedback}` — distillation replaces `content`; `additionalContexts` appends UserMessages to the next request (secondary injection channel for drift notes).
8. **Failure containment**: listener failures are contained (`tools/result` is emit-mode); our own listeners must still stay fail-open by contract.
9. **Headless reload**: `patchReload: "startup"` — no live HMR in headless; HMR probe moves to web profile in T2 as designed.

## Deferred to T2 (not T0 scope)

- Tarball install path (`pnpm pack` → `dsh plugin add <tgz>`), remove/re-add idempotence, HMR/reload, web-profile named probes, doctor leg, churn lint.
- A run where the model itself denies (URL-policy deny end-to-end on a model-requested call).
