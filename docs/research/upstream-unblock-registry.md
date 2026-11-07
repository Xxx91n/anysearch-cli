# Upstream-blocked debt issues — unblock-signal registry

Wayfinder ticket #97. One section per upstream-blocked issue: the concrete
fact that makes it actionable (解除信号) and its alignment with
`docs/limitations.md` (登记状态). Signals were derived from each issue's own
text plus the code surface it names — verified against the tree at
`research/upstream-registry` branched from `main@61d6398f`, and re-checked on
`main@73ada6b` when the registry landed in `docs/research/` (#171) — where
登记状态 also reflects the entries actually added to `docs/limitations.md`.

## #18 transformers.js undeclared external (onnxruntime-common) — remove the scoped Module._resolveFilename patch when upstream declares it

解除信号: An `@huggingface/transformers` release (current pin `^3.7.0`,
`packages/embedding/package.json`) declares `onnxruntime-common` in its own
`dependencies`/`peerDependencies` — i.e. `transformers.node.cjs`'s
`require("onnxruntime-common")` stops being an undeclared external. Verify by
inspecting the published package manifest of the new release; then remove the
scoped `Module._resolveFilename` patch (`patchOnnxruntimeCommonResolve`,
`packages/embedding/src/index.ts:31-45`), our self-declared
`onnxruntime-common@1.21.0` optionalDependency, and
`packages/embedding/test/transformers-ghost-dep.test.ts`.

登记状态: absent — 建议只留 issue，不补登。理由：the patch is a fully
internal, invisible workaround — when it works there is no user-visible gap
(pnpm-isolated installs resolve correctly today). `docs/limitations.md`
records user-facing limitations, not maintenance hazards; the hazard
(accidental patch/dep removal) is already pinned by the header comment at
`packages/embedding/src/index.ts:17-29` and the ghost-dep test, which is the
correct guard rail.

## #22 ESM arm for the transformers ghost-dep patch — module.registerHooks resolve fallback (named return ticket)

解除信号: Either (a) the same upstream fix as #18 lands — a transformers.js
release declaring `onnxruntime-common` makes the ESM arm unnecessary outright
— or (b) we adopt Node's `module.registerHooks` (resolve hook, stable since
Node 22.15 / `module.register` since 20.x) to cover the `.mjs` path, which the
current patch cannot reach (comment at `packages/embedding/src/index.ts:26-27`:
"the .mjs path uses the ESM resolver which cannot be scoped without loader
hooks"). Concretely actionable when a consumer in this repo actually imports
`@huggingface/transformers` via ESM, or when the min Node floor makes
`registerHooks` unconditionally available.

登记状态: absent — 建议只留 issue，不补登。理由：no shipped code path loads
transformers via ESM (`loadTransformers` uses `createRequire`, CJS-only), so
there is no user-visible limitation to register — the missing arm is a latent
gap, not a present one. If an entry is ever added for #18 it covers this file
too.

## #23 api.anysearch.com REST `/v1/search` 事实修正（前提无效，已关闭）

解除信号: 无 — the original "REST route retired / watch for resurrection"
premise was invalid, so there is no signal to wait for. Live probe 2026-11-07:
`GET https://api.anysearch.com/v1/search` → 404;
`POST https://api.anysearch.com/v1/search` → 200 with a `code:0` envelope
(`request_id` present). The adapter stays MCP-only
(`packages/retriever/src/providers/anysearch.ts`); the `LEGACY_REST_SUFFIX` →
`/mcp` rewrite in `normalizeEndpoint` is a compatibility shim for endpoint
configs that still name the REST route, not evidence of a retirement. Closed as
an invalid premise; a REST provider arm is out of scope for #203 (open a
separate product ticket if one is wanted).

登记状态: registered — `docs/limitations.md` L212-220, rewritten by #206 (the
remaining user-facing fact is the MCP-only rewrite, not a dead REST route):

```md
- **AnySearch REST `POST /v1/search` is live; this adapter is MCP-only** — live
  probe 2026-11-07: `GET /v1/search` returns 404, while `POST /v1/search` returns
  200 with a `code:0` envelope. The provider speaks MCP Streamable HTTP at
  `POST /mcp` only, so an `ANYSEARCH_ENDPOINT` (or explicit endpoint arg) ending
  in `/v1/search` is auto-rewritten to `base+/mcp` with a once-per-process
  stderr warning — a compatibility shim, not a sign that REST is retired.
  Upstream `request_id` in the reply envelope is a server-generated diagnostic
  UUID (also returned as `X-Request-ID`): a caller-supplied value is ignored,
  and it is not an idempotency key.
```

## #24 ip 第五域语料建集（触发条件=上游为 ip 子域补结构化参数词表）

解除信号: `get_sub_domains(domain="ip")` on `https://api.anysearch.com/mcp`
returns a structured per-tag parameter vocabulary for the `ip` domain —
i.e. the same shape the `finance.*` entries already produce (per-tag param
tables like `type`/`symbol`/`cn_code`; see `docs/vertical-domains.md:19-22`).
Today `ip` exists only in the 17-value top-level domain enum
(`docs/vertical-domains.md:12-14`) and `eval-looks.json` contains zero
`domain:"ip"` entries. Actionable the moment the probe output has a
harvestable param table: write `vert-i*` corpus entries into
`eval-looks.json` following the `vert-f11xx`/`vert-f12xx` pattern.

登记状态: absent — 建议只留 issue，不补登。理由：the missing corpus is an
internal eval gap with no product surface, and `docs/vertical-domains.md`
already states the snapshot defers to the live `get_sub_domains` tool
(`docs/vertical-domains.md:3-8`) — registering a limitation would duplicate
that disclaimer without telling the user anything actionable.

## #25 上游匿名配额边界形态=auto-provisioning 凭证签发文本（200+isError:null+非结果正文）；provider 已具名归类 permanent-auth；env/key 修正归用户侧

解除信号: The upstream anonymous-quota boundary changes shape — i.e. a probe
of an anonymous (no `ANYSEARCH_API_KEY`) `tools/call search` at the quota
boundary stops returning the auto-provisioning payload (HTTP 200 +
`isError:null` + "account ... automatically generated ... api_key=..." text)
and instead returns a real error (`isError:true`, 401/403, or a structured
quota error). At that point the `/automatically generated|api_key *=/i`
detector and the "quota/auth nudge" permanent-auth throw
(`packages/retriever/src/providers/anysearch.ts:148-157`; classification at
`packages/retriever/src/contract.ts:230`; fixture test
`packages/retriever/test/provider-error-class.test.ts:21`) must be re-mapped.
The client-side handling itself is complete — the ticket closes by
re-verifying the boundary still behaves as coded.

登记状态: registered — `docs/limitations.md` L166-170, landed in #171 (the
anonymous-quota wall is user-facing: callers hit `permanent-auth` and are told
to set `ANYSEARCH_API_KEY`):

```md
- **Anonymous `anysearch` calls hit a quota wall classified `permanent-auth`** —
  upstream answers quota-exhausted anonymous calls with an auto-provisioning
  payload (HTTP 200, `isError:null`, no result body) instead of an error;
  the provider names this `quota/auth nudge` → `permanent-auth`. Fix is
  user-side: set `ANYSEARCH_API_KEY`.
```

## #27 上游 finance.fundamental 的 validator 按 tag 级索要 cn_code，与 sub_domains 词表文档的 per-type 规则不一致（vert-f1105 格降格根因）

解除信号: `tools/call search` with
`domain="finance", sub_domain="fundamental", sub_domain_params={type:"overview", symbol:"MSFT"}`
stops returning `isError` — i.e. the upstream validator accepts `symbol`
without `cn_code` at the tag level, matching the per-type rule documented in
`get_sub_domains` output (`docs/vertical-domains.md:21-22`: "requires `type`
plus `symbol` or `cn_code` per type"; live-verified still rejecting on
2026-10-01 per the `vert-f1105` tombstone note at `eval-looks.json:1119`).
At that point, lift `vert-f1105` out of
`tombstone{reason_code:"upstream-validator-vs-doc-mismatch"}`
(`eval-looks.json:1099-1151`) back to live scope using `prior_spec` /
`prior_expected_vertical` preserved in the tombstone.

登记状态: registered — `docs/limitations.md` L171-176, landed in #171 (a
documented-valid param combination being upstream-rejected is user-facing —
callers of finance.fundamental hit `isError` for input the vocab doc says is
legal):

```md
- **Upstream `finance.fundamental` validator over-requires `cn_code`** — the
  `get_sub_domains` vocab documents `type` + `symbol` *or* `cn_code` per
  type, but the live validator demands `cn_code` at the tag level, so
  e.g. `{type:"overview", symbol:"MSFT"}` returns `isError`. Pass `cn_code`
  where the doc implies `symbol` suffices (eval cell `vert-f1105` is
  tombstoned on this; see `eval-looks.json`).
```

## #32 Tavily provider 无法取消：SDK 不暴露 AbortSignal

解除信号: A `@tavily/core` release (current pin `^0.7.7`,
`packages/retriever/package.json`) exposes an abort/`signal` option on
`search()` (or request-level client config). Verified against SDK source
2026-09: "no AbortSignal support in search options ... SDK uses internal
timeout" (comment at `packages/retriever/src/providers/tavily.ts:33-34`).
Then forward `SearchRequest`'s `signal` param (accepted at `tavily.ts:30`
per contract but currently dropped) into the SDK call.

登记状态: registered — `docs/limitations.md` L65-67
("**Tavily does not forward `AbortSignal`** — provider-side timeouts are not
cancelable through the SDK ... the kernel budget guard still bounds wall
time."). No new entry needed; the issue stays open as the upstream-watch
handle.

## #33 Tavily usage() 恒 undefined：仅 per-call credits，无独立用量 API

解除信号: Tavily ships a standalone usage/quota API endpoint (account-level
credits consumption queryable outside a search call). Today usage exists only
as per-call `response.usage.credits` — the provider hard-codes
`usage: undefined` in the envelope and ships no `usage()` method
(`packages/retriever/src/providers/tavily.ts:68,72-73`; contract `usage?` is
optional). Actionable when Tavily documents/ships the endpoint: implement
`usage()` mapping to the standalone API (and optionally surface the per-call
`credits` in the envelope meanwhile).

登记状态: registered — `docs/limitations.md` L177-179, landed in #171:

```md
- **Tavily envelope `usage` is always `undefined`** — `@tavily/core` returns
  credits only per-call (`response.usage.credits`) and offers no standalone
  usage API, so `usage()` is unimplemented (contract field is optional).
```

## #34 Exa usage() 恒 undefined：仅 per-call costDollars，无独立用量 API

解除信号: Exa ships a standalone usage/billing API endpoint (account-level
spend queryable outside a search call). Today cost exists only as per-call
`costDollars` on the response — the provider hard-codes `usage: undefined`
and ships no `usage()` method (`packages/retriever/src/providers/exa.ts:82,86-87`;
pin `exa-js@^2.18.1`). Actionable when Exa documents/ships the endpoint:
implement `usage()` mapping to it (and optionally surface `costDollars` in
the envelope meanwhile).

登记状态: registered — `docs/limitations.md` L180-182, landed in #171:

```md
- **Exa envelope `usage` is always `undefined`** — `exa-js` returns cost only
  per-call (`costDollars`) and offers no standalone usage API, so `usage()`
  is unimplemented (contract field is optional).
```

## Summary

| Issue | Surface that changes | 解除信号 (trigger fact) | 登记状态 |
|-------|----------------------|--------------------------|----------|
| #18 | `packages/embedding/src/index.ts:31-45` + `package.json` optionalDep | transformers release declares `onnxruntime-common` | absent — issue-only (internal patch) |
| #22 | `packages/embedding/src/index.ts` ESM path | #18 fix lands, or ESM consumer appears / `module.registerHooks` adopted | absent — issue-only (no shipped ESM load path) |
| #23 | `anysearch.ts` `LEGACY_REST_SUFFIX`/`normalizeEndpoint` | none — closed as invalid premise (`POST /v1/search` is live; only GET is 404) | registered — `docs/limitations.md` L212-220 |
| #24 | `eval-looks.json` (`vert-i*` entries) | `get_sub_domains(domain="ip")` returns structured param vocab | absent — issue-only (eval-internal, doc already defers live) |
| #25 | `anysearch.ts:148-157` detector + `contract.ts:230` | anonymous quota boundary stops returning provisioning payload | registered — `docs/limitations.md` L166-170 |
| #27 | `eval-looks.json` `vert-f1105` tombstone (L1099-1151) | `{type:"overview",symbol}` accepted without `cn_code` | registered — `docs/limitations.md` L171-176 |
| #32 | `tavily.ts:30-34` signal forwarding | `@tavily/core` exposes `signal`/abort option | **registered** — limitations.md L65-67 |
| #33 | `tavily.ts:68,72-73` `usage()` | Tavily standalone usage API exists | registered — `docs/limitations.md` L177-179 |
| #34 | `exa.ts:82,86-87` `usage()` | Exa standalone usage API exists | registered — `docs/limitations.md` L180-182 |

Legend: "issue-only" rows are adjudicated as sufficiently tracked by the
issue itself plus in-code comments/tests — registering them in
`docs/limitations.md` would document a limitation users cannot observe.
