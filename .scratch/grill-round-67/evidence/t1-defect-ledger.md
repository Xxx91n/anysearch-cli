# R67-T1 expected-red ledger — Codex CLI 0.142.5 (real host, published 0.0.4)

Track A object = npm-global published 0.0.4 (D:/nodejs/node_modules/@anysearch-cli/*). <!-- machine-local: toolchain install prefix on build host @ 2026-09-19 -->
Host = codex 0.142.5 via `codex exec --json --ephemeral --skip-git-repo-check` + `--ignore-user-config` + `-c` provider reinjection (auth via CODEX_HOME auth.json). Hook legs additionally carry `--enable hooks` + `--dangerously-bypass-hook-trust` (labeled trust-bypass vehicle; the trust GATE itself is separately evidenced by W4/W6 NOFIRE legs) and tool-call legs add `--dangerously-bypass-approvals-and-sandbox`.
Primary observable = marker propagation into agent_message / observable side effect (marker file, .mdc write, /index db delta, mcp_tool_call presence). Plugin server on 127.0.0.1:33334 (token via env, never persisted to evidence).

## A. Contract-form adjudication (SessionStart)

| Leg | Output form | Verified fired | Marker reached model | Verdict |
|-----|-------------|----------------|----------------------|---------|
| L0  | `{}` | yes (t1-l0y) | n/a — NO_TOKEN correct | clean baseline |
| L1  | `{hookSpecificOutput:{hookEventName,additionalContext}}` | yes | 4/4 (e3,e1s1-3) | **RELIABLE** |
| L2  | `{additionalContext}` bare top-level | yes | 1/8 (l2y only; l2r1-3,l2s4-7 fail) | **UNRELIABLE ~12%** |
| L3  | plain text stdout | yes | 3/3 | **RELIABLE** |
| L1' | `{systemMessage + hookSpecificOutput}` | yes | 1/1 | works (tolerance) |
| L2R | real 0.0.4 session-start.cjs bare | yes (mdc side-effect) | 1/3 (rb2 pass; L2R,rb1 fail) | real artifact = racy-broken |
| L2E | real 0.0.4 session-start.cjs --envelope | yes (mdc) | 1/1 GOT_CARD | fix path works |

Evidence: t1-{e3,e1s1-3,l2y,l2r1-3,l2s4-7,l3z,l3s1-2,l1pz,l0y,rb1-2,l2e-envelope-004}.* under evidence/; hook-fired.jsonl records per leg; mdc side-effect = .cursor/rules/anysearch.mdc mtime 06:29Z.

## B. PreToolUse deny sentinel (matcher mcp__anysearch__search_web, real MCP wired)

| Form | Tool executed? | Verdict |
|------|----------------|---------|
| envelope `permissionDecision:"deny"` | NO (TOOL_BLOCKED, no mcp item) | **deny works** |
| legacy `{decision:"block"}` | NO (TOOL_BLOCKED) | **deny works** |
| top-level `{permissionDecision:"deny"}` | YES (TOOL_OK, results returned) | ignored — undocumented |
| exit code 2 + stderr | YES (TOOL_OK) | **exit-2 is NOT a deny on Codex** (hook-error ≠ deny; host treats as benign) |

Evidence: t1-deny-{env,legacy,toplevel,exit2}.stream.jsonl — DENYTAG lines in execution record.

## C. additionalContext under tool events

- PreToolUse additionalContext: envelope 0/1, bare 0/1 — marker did NOT reach model either form (fired verified). Host appears to mute PreToolUse ctx injection on this surface → host-variable, not product defect (still emit envelope; harmless).
- PostToolUse additionalContext: envelope **1/1 markerInAgent** (ANS_R67_EV_poEV), bare 0/1 → envelope required, same defect class as SessionStart.

## D. Config-schema red (shipped 0.0.4)

- `apps/plugin/configs/codex/hooks.json` uses Claude-style entries (`{name,command,args}`); Codex registers ZERO commands — silent no-op both with and without `--enable hooks` + bypass (t1-shippedcfg, t1-shippedcfg-en; contrast: top-level `description` field DID parse-error — root is strict, entries are not).
- Config references `${CODEX_PLUGIN_DIR}` — no such expansion exists in Codex → even schema-fixed, paths must be resolved at install time.
- Adapter output shape: codex.cjs emits bare `{additionalContext}` at top level for BOTH PreToolUse (L240) and PostToolUse (distilled output). Real-host: mostly/neither consumed → dead output.
- Adapter drops `decision.permission` entirely — makePreToolUseDecision may return deny/ask (URL policy, preheat.ts L79-94); adapter writes nothing → **URL-policy deny silently inert on Codex** (real-host: envelope deny verified working).

## E. Synthetic-stdin contract (published 0.0.4 codex.cjs, server 33334)

- `hook_event_name:'PostToolUse'` → adapter acted: bare stdout emitted AND /index wrote +2 rows (db delta project_index 0→2, recall_after=2). 
- legacy `event:` → same processing (dedup → +0). Input-field contract OK (`hook_event_name ?? event` fallback honored).
- stdout shape captured = bare `{"additionalContext":"{\"tool\":...}"}` — the defective form on real host.
Evidence: t1-synthetic-red3.log

## F. Host-behavior items (not product defects)

- Trust gate: no-bypass runs skip hooks SILENTLY (W4 valid-schema project hooks + W6 project-trust -c both NOFIRE); bypass fires (E3). Hash-trust persistence is interactive/headless-gated → labeled bypass legs are the isolation vehicle.
- required=true MCP: init failure → exec hard-fails "required MCP servers failed to initialize" (t1-mcp-required-fail.debug.log). Matches docs; differs from Claude soft-degrade.
- Real stdin fields observed: session_id, transcript_path(null under --ephemeral), cwd, hook_event_name, model, permission_mode, source:"startup" (fired-proof records).
- OOD leg: mcp_servers.anysearch via -c works; search_web returned 10 real results, abstain=null — rescored under Track B P3.

## G. Disposition

- **xfail-strict (fix in T3)**: codex-config-schema, codex-adapter-output-bare (Pre/Post/SessionStart), codex-adapter-deny-dropped, CODEX_PLUGIN_DIR resolution.
- **skip-with-reason (host-variable)**: PreToolUse ctx muting, bare-form ~18% racy delivery, exit2-not-deny (document), trust-gate headless behavior.
- **closed-green**: input fields (hook_event_name honored), MCP wiring, required-sentinel, synthetic /index delta, OOD connectivity.

---

# R67-T2 Track B ledger — tarball candidates (clean-install pkg-t, 0.0.4 content)

Object = pnpm pack tarballs installed to D:/Aworker/e2e-r67-codex/pkg-t (npm --no-save). Host = codex 0.142.5, isolation via CODEX_HOME=D:/Aworker/e2e-r67-codex/.codex-home (config.toml mirrors user's real form: model_provider custom @127.0.0.1:20128, features.hooks=true, [[hooks.*]] entries, mcp_servers.ansprobe). Trust: --dangerously-bypass-hook-trust for headless (labeled); project-file layer separately proven. <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->

## B1. stdio matrix on tarball MCP
| Leg | Result |
|-----|--------|
| P1 tools/list | 5 tools: search_web research_web recall_memory query_knowledge ans_chat (t2-p1-list.log) |
| P2 domain-in | docs wedge: results all typescriptlang.org/mcp.io (t2-p2-domain.log) |
| P3 OOD | allowlist-routed (mcp.io/pnpm.io), abstain=null — gate works, abstain shape noted (t2-p3-ood.log) |
| P4 recall_memory | projectIndex hits=4 ONLY with ANS_PROJECT_DB set — env contract (t2-p4b-recall.log) |
| P5 query_knowledge | "adapter=none (not yet implemented)" — stub, skip-with-reason |
| P7 fail-open | search_web works with plugin server killed (t2-p7-failopen.log) |
| P8 restart | server respawn on 33334 healthy (pid 6776) |

## B2. Real-host Codex + tarball hooks (the decisive legs)
- PostToolUse REAL tarball adapter: FIRED 2× (env-dump records) + project_index +9 rows real distilled results @08:38Z (t2-realpost-tb3.*). End-to-end index path GREEN.
- env propagation to hooks CONFIRMED: ANS_SERVER_URL/ANS_SERVER_TOKEN reach hook env (env-dump9 records).
- Matcher semantics: FULL-MATCH regex — 'mcp__ansprobe__' does NOT match 'mcp__ansprobe__search_web'; '.*' and exact names do. Ships-config matchers must use 'mcp__anysearch__.*' form (or exact). **xfail-strict → T3**
- Config locations: [hooks.*] in CODEX_HOME config.toml fires; project .codex/hooks.json fires when project trusted via user config + bypass (env-dump SessionStart record in tb2 leg proves project layer live).
- -c injection for hooks: NOT TOML-parsed (value treated as string → "expected a sequence" error). -c unsuitable for hook defs; use config file layer.
- PreToolUse via real adapter (tarball): fires (envdump9) — bare additionalContext output form = same real-host defect.
- Deny-drop defect: adapter drops decision.permission entirely; with empty policy {} no deny occurs → latent. Host-side: envelope/legacy deny verified working (T1-B).

## B3. Disposition deltas vs T1
- All T1 xfail-strict items reproduce identically on tarball (config schema, bare output, deny drop, CODEX_PLUGIN_DIR).
- NEW: hook matchers in any shipped config must be full-match-safe (mcp__anysearch__.* not prefix).
- NEW: -c cannot express hooks (string-typed) → install must write config file, not rely on -c.

---

# Numbered index (R67 audit F-04 closeout — same items, formal IDs + failure_class)

| ID | Item | failure_class | Disposition | Closure pointer |
|----|------|---------------|-------------|-----------------|
| ER-01 | codex-config-schema ({name,command,args} → zero hooks) | product-defect | xfail-strict → **fixed** (3e5087a) | .scratch/grill-round-67/evidence/t4-shippedcfg.* |
| ER-02 | codex-adapter-output-bare (Pre/Post/SessionStart top-level) | product-defect | xfail-strict → **fixed** (3e5087a) | envelope t4 legs + codex-contract.test.ts |
| ER-03 | codex-adapter-deny-dropped (decision.permission lost) | product-defect | xfail-strict → **fixed** (3e5087a) | .scratch/grill-round-67/evidence/t4-deny.* |
| ER-04 | CODEX_PLUGIN_DIR resolution (no such var) | product-defect | xfail-strict → **fixed** (bin-name commands) | shipped config + tarball bin map |
| ER-05 | matcher full-match semantics (prefix ≠ match) | host-fact → product-defect | xfail-strict → **fixed** (suffix-anchored) | shipped config matcher + contract test |
| ER-06 | PreToolUse additionalContext muted by host | host-variable | skip-with-reason | §C (0/1 both forms; envelope still emitted, harmless) |
| ER-07 | bare-form racy delivery (~12-33%) | host-variable | skip-with-reason (documented; product emits envelope) | §A L2/L2R legs |
| ER-08 | exit code 2 is not a deny on Codex | host-fact | skip-with-reason (documented) | §B deny sentinels |
| ER-09 | hook trust = [hooks.state] sha256; headless gate | host-variable | skip-with-reason (bypass legs labeled) | §F W4/W6 NOFIRE |
| ER-10 | -c cannot express hooks (string-typed values) | host-fact | skip-with-reason (documented) | §B3 + t2-bisectC2/t2-envdump8 |
| ER-11 | required=true MCP hard-exit | host-fact | closed-green (matches docs) | t1-mcp-required-fail.* |
| ER-12 | input fields / MCP wiring / synthetic /index delta / OOD connectivity | — | closed-green | §E/§F + t2 legs |
