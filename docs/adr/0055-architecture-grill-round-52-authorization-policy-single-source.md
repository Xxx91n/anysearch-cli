# ADR-0055: Architecture Grill Round 52 - Authorization Policy Single Source Unification

Status: Accepted.

## Context

ADR-0054 deferred the dual-source drift problem: kernel `shouldAllowUrl` reads TOML `[sources].urlAllowlist` while the plugin hook `preheat.ts` independently reads env `ANS_URL_ALLOWLIST`. Two sources independently judge URL authorization — drift is guaranteed, not possible. Industry consensus is policy-as-code: one authoritative policy, evaluated everywhere, load-time drift assertion, config-change audit. This round unifies authorization configuration into a single source of truth with a derived-consumer topology.

## Decisions

### D1 Authoritative Source

TOML `[sources].urlAllowlist` is the SINGLE authoritative source. `ANS_URL_ALLOWLIST` env is demoted to a dev-only additive override layer requiring explicit opt-in (`ANS_ALLOW_ENV_OVERRIDE`), semantics = TOML ∪ env (append-only: can only add hosts, never subtract). Rationale: env has five evidenced leak/injection paths (subprocess inheritance, /proc/PID/environ, CI logs, image layers, Shai-Hulud precedent); 12-factor's env-config guidance explicitly excludes security policy. Claude Code precedent: env may override individual non-security keys, never Managed-layer security policy.

### D2 Merge Semantics

allow = union across layers (append-only; Claude Code array-merge + AWS IAM union, dual official sources). deny is NOT part of the union array — it is a first-class independent channel, evaluated LAST, unbypassable by any layer or hook (Cedar forbid-overrides-permit formalization; AWS explicit deny overrides allow; GitHub Enterprise deniedMcpServers unconditional override, even when an allow entry matches). `shouldAllowUrl` evaluates allow, then the deny table overrides finally.

### D3 Failure Semantics: Two Layers

Load layer fail-closed: TOML parse failure / unrecognized override-switch value / conflict without explicit opt-in → refuse to start, error names the variable and offending value (OpenSSH refuse-to-start; Cedar Strict validation at store write; OPA rejects a bad bundle and keeps the old one). Evaluation layer skip-on-error: a single entry failure denies that entry + logs, never denies all (Cedar officially REJECTED deny-on-error — the 101st-bad-policy incident argument). warn → enforce phased rollout semantics reserved.

### D4 Distribution Topology

Server single-point parse + `GET /policy` push-down. The plugin server (127.0.0.1:33333, long-lived) resolves TOML + env merge + deny + policy_version in ONE place; hook short-lived child processes consume the same parsed result over the existing narrow HTTP IPC (isomorphic to `/recall`). Supplementary: server atomically materializes `.anysearch-cli/policy.json`; hook reads the file first (0ms), pulls only when server reachable AND version newer; server unreachable → use cache; no cache AND server down → fail-closed ask (authorization is a security boundary; ADR-0009 fail-open applies only to the index/distillation gain layer). Rejected: (b) shared parse function per hook process = same function, N independent states — still dual-source in essence, and breaks the kernel-no-env / composition-root discipline; (c) pure materialization has no trigger mechanism for TOML changes.

### D5 Runtime Write-Back Path

`ans hitl --allow-url` keeps writing the TOML authoritative source (two industry precedents point at write-back-to-file: OPA forbids runtime mutation of bundle policy; Claude Code "always allow" writes the settings file), upgraded to structured atomic write + round-trip verify. No notification mechanism needed for hot reload — hook short-lived processes re-read per event; kernel re-reads lazily per call via mtime check. After write, emit a ConfigChange audit event.

### D6 Policy Version and Drift Detection

`policy_version = sha256(canonical merged JSON)` where canonical = sort(dedupe(trim(lowercase(hosts)))) (turborepo `to_hashable` hash-input precedent). env override participates in the hash. Drift detection = version comparison (OPA `active_revision` semantics); server compares the content hash at parse time and emits a ConfigChange audit event on change (old_version → new_version + trace_id), which also catches manual TOML edits. No TTL — event-driven re-read is inherently fresh; if a forced refresh ceiling is needed later, OPA short-poll baseline is 10s.

### D7 Env Override Switch Semantics

Five-state truth table. Strict-enum parsing: `ANS_ALLOW_ENV_OVERRIDE` accepts only {1,true} / {0,false} case-insensitive; any other value (yes/on/2/...) → fail-closed refuse to start naming variable + value (K8s feature gates / Go ParseBool / clap BoolishValueParser; existence-is-true excluded by clap #1649 + ccache #182 misuse evidence).

| # | Switch | env | Behavior | policy_version | Logging |
|---|--------|-----|----------|----------------|---------|
| 1 | unset | unset | TOML authoritative | canon(TOML) | none |
| 2 | unset/0/false | set non-empty | env IGNORED | == state 1 | stderr WARN + `config:env_override_ignored` audit once per session |
| 3 | 1/true | non-empty | TOML ∪ env merged, append-only | canon(TOML ∪ env) | info "override active: N hosts" |
| 4 | 1/true | empty/blank | same as state 1 | == state 1 (byte-equal, no cache thrash) | debug |
| 5 | unrecognized | any | refuse to start | — | fail-closed error |

Silent ignore of security config is a defect (Claude strictAllowlist bug report; python-dotenv silent-failure precedent); audit write failure degrades to stderr (AGENTS.md fail-open). Illegal env entries fail-closed refuse to start — same strictness as the TOML side: an entry that cannot be added is a config error the developer must see. kernel and hook MUST share one `mergeAllowlist` + `canonicalVersion` implementation (shared package); a golden case locks state-1 vs state-4 hash equality.

### D8 ConfigChange Audit Event

Fields: `{ event_id, timestamp, actor, source(toml|env|cli), path, change(before/after), policy_version, trace_id, session_id }`, written to the ADR-0052 local trace store, optional OTLP export. OPA v0.55 decision log natively carries trace_id/span_id; CloudTrail `eventContext` binds authorization context — the field set is landed industry practice, not invention.

## Consequences

- Dual-source drift is eliminated at the root: one `mergeAllowlist` + one `canonicalVersion` shared by kernel, server, and hooks.
- `ANS_URL_ALLOWLIST` without the opt-in switch stops silently participating in authorization; the behavior change is observable via WARN + audit event.
- New `GET /policy` endpoint and `.anysearch-cli/policy.json` cache file join the IPC surface.
- The env override switch is an original design (no second product precedent); recorded as a design decision, supported by adjacent evidence.
- Golden-case suite grows: hash-equality lock, five-state truth table, deny-final-override, fail-closed on misset switch.

## Implementation Plan

1. Land this ADR and CONTEXT.md updates (docs-only).
2. Extract shared `mergeAllowlist` + `canonicalVersion` (canonical = sort/dedupe/trim/lowercase) into a shared package consumed by kernel, server, and hook.
3. Server: add `GET /policy` (resolve + merge + deny + hash + atomic policy.json write).
4. Hook: new `readPolicy()` (read cache → version compare → pull; no cache + pull failure → fail-closed ask); replace the `preheat.ts` env-read block wholesale.
5. kernel `pi-runtime.ts` allowlist source: lazy mtime-checked re-read per call.
6. CLI `hitl.ts`: structured atomic TOML write + round-trip verify + ConfigChange audit event after write.
7. Wire ConfigChange events into the ADR-0052 local trace store.
8. Golden cases: five-state truth table, hash equality (state 1 vs 4), deny final override, fail-closed on misset switch.
9. Full verification: `pnpm -r check/test/build`, ship-gate, eval golden unchanged.

## Acceptance

1. Single parse point: hooks no longer read `ANS_URL_ALLOWLIST` directly; grep proves only the shared resolver consumes both sources.
2. Golden cases for the five-state truth table all pass; state 1 and state 4 produce byte-identical policy_version.
3. A deny entry overrides any allow match, including a hook-returned allow.
4. `ANS_ALLOW_ENV_OVERRIDE=yes` → process refuses to start with variable name + offending value in the error.
5. Full verification green: check/test/build/ship-gate; eval golden passRate unchanged.

## Research Sources (three atomcode rounds, 40+ sources)

- OPA management-bundles / management-status / decision logs v0.34.2 + v0.55.0 (trace_id/span_id, active_revision, persist bundle)
- Cedar authorization docs (default-deny, forbid-overrides-permit, skip-on-error, deny-on-error rejection rationale)
- AWS IAM policy evaluation logic (explicit deny overrides allow; union semantics)
- AWS CloudTrail record contents (eventContext authorization context)
- Claude Code settings + hooks docs (five-layer precedence, array merge, deny-not-bypassable, ConfigChange matcher)
- Kubernetes: ConfigMaps, admission webhook good practices (failurePolicy lockout), feature gates strict enum, client-go envvar.go (ignored-and-logged)
- Envoy xDS protocol (version_info, ACK/NACK, NACK retains last-valid)
- 12-factor config; plural.sh GitOps single-source; safeguard.sh + Sourcery env leak paths (Shai-Hulud)
- GitHub Enterprise MCP allowlist (deniedMcpServers unconditional override, fail-closed)
- clap #1649 / ccache #182 (existence-is-true misuse evidence); clap BoolishValueParser; Go strconv.ParseBool
- click #1790 (empty = unset intentional design); envbool; python-dotenv #631 (silent-failure antipattern); lima envutil.go parseEnvList; turborepo to_hashable; cosca sanitize.rs; auditd.conf syslog throttle; OpenSSH sshd_config(5)
