# ip domain probe — 2026-11-07

Evidence anchor for ticket **#24** (ip fifth-domain corpus) under spec **#203**
(T12). The corpus entries `vert-i11xx` / `vert-i12xx` / `ctrl-i10x` in
`eval-looks.json` cite this file as their provenance ref.

## Trigger

The original deferred-registry entry said the corpus work becomes actionable
"the moment the probe output has a harvestable param table". This probe
confirms the trigger: `get_sub_domains(domain="ip")` now returns a structured
per-parameter table, the same shape the `finance.*` entries already produce.

## Method

- Endpoint: `https://api.anysearch.com/mcp` (Streamable HTTP MCP).
- Probe path: `initialize` (protocol `2025-03-26`, no `mcp-session-id`
  response header) → `notifications/initialized` → `tools/list` →
  `tools/call get_sub_domains {domain:"ip"}` → `tools/call search` samples.
  The two `tools/call` request bodies were:

  ```json
  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_sub_domains","arguments":{"domain":"ip"}}}
  ```

  ```json
  {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search","arguments":{"query":"solar cell patents","domain":"ip","sub_domain":"ip.global","sub_domain_params":{"type":"GlobalPatent","keyword":"solar cell"}}}}
  ```

- Date: 2026-11-07. An API key was present; the key is never recorded here.
- Read-only: the probe calls `get_sub_domains` and `search` only. No runtime
  wiring changed.

`tools/list` returned `batch_search`, `extract`, `get_sub_domains`, `score`,
`search` — the same five names already documented as upstream drift; only
`search` is wired in this repo.

## Raw vocabulary table

```text
## ip Domain Capabilities (1 available)

### ip.global
Global patent aggregation and family tracing via EPO DOCDB/INPADOC, covering 100+ countries with legal status

**Parameters:**
- `type`: GlobalPatent (global patents)
- `keyword`: solar cell / AI (search keyword)
- `applicant`: Huawei / Huawei Technologies (applicant/organization name filter)
- `ipc`: H01L / G06N (IPC/CPC classification filter)
- `date_start`: 2020 / 20200101 (publication/application date start)
```

There is exactly one `ip` sub-domain (`ip.global`). The table lists five
parameters; `type` is the result-shape selector, the rest are filters.

## Search-shape matrix

All calls used `domain: "ip"` (plus `sub_domain` / `sub_domain_params` where
shown) and the upstream markdown envelope. Counts are the header counts of
the `## Search Results` envelope.

| Case | `isError` | Result count | URL hosts in envelope |
|---|---|---|---|
| domain only (no sub_domain) | absent | 10 | general web news (`elecfans.com`, `mydrivers.com`, `cnbeta.com`, `sgpjbg.com`, …) |
| `ip.global`, no params | absent | 9 | none — patent records are text-only |
| `type=GlobalPatent` | absent | 10 | `worldwide.espacenet.com` |
| `keyword=solar cell` (no type) | absent | 10 | `analytics.patsnap.com`, `worldwide.espacenet.com` |
| `type=GlobalPatent`, `ipc=H01L` | absent | 10 | `worldwide.espacenet.com` |
| `type=GlobalPatent`, `date_start=20200101` | absent | 10 | `worldwide.espacenet.com` |
| `type=GlobalPatent`, `applicant=Huawei`, `date_start=20230101` | absent | 7 | none — text-only |
| `type=bogus_type` | absent | 8 | none — unknown type value is silently tolerated |
| `ip.bogus_xyz` | **true** | — | `Invalid tag: ip.bogus_xyz.` |

Consequences used by the corpus:

- `hitHosts` measurement pools are `espacenet.com` and `patsnap.com` (suffix
  matching covers `worldwide.espacenet.com` / `analytics.patsnap.com`); all
  five parameterized entries define `hitHosts`, and `hitPaths` is `/patent/`
  where URL lines were observed.
- The semantic entries use `{domain:"ip"}` (domain-only), matching the
  finance/academic/code/health semantic stratum. A parameterless
  `ip.global` spec was tested first, but its responses are frequently
  text-only (no `- **URL**` line); `parseSearchMarkdown` drops URL-less
  blocks, so a `hit:true` assertion would be unobservable and the live layer
  would fail. Supporting text-only records is a provider-normalization
  follow-up outside this corpus ticket. Domain-only `ip` returns URL-bearing
  general results, so the vertical marker/hit contract stays measurable.
- A bogus `ip` sub-domain is a hard upstream rejection, the surface the
  `ctrl-i103` control pins; a bogus `type` *value* is not, so no control
  asserts an error for it.
- Domain-only `ip` silently falls back to general web (the `ctrl-i102` /
  `ctrl-i104` surfaces), exactly like the other domains.

Follow-up probe (2026-11-07, same endpoint) for the rows that stay
parameterized:

| Case | Result count | `- **URL**` lines |
|---|---|---|
| `type=GlobalPatent`, `applicant=Huawei` | 10 | 3 (`worldwide.espacenet.com`) |
| `type=GlobalPatent`, `applicant=Huawei`, `keyword=5G` | 10 | 3 (`worldwide.espacenet.com`) |
| `type=GlobalPatent`, `applicant=BYD`, `keyword=solid-state battery`, `date_start=20220101` | 10 | 8 (`worldwide.espacenet.com`) |
| domain-only `ip` (TSMC / FRAND questions) | 10 | 10 (general web hosts) |

## Scope

This snapshot is for eval-corpus construction only. It does not add an `ip`
sub-domain enum to the runtime adapter, and `get_sub_domains` is still not
wired as a shipped tool (spec #203 Out of Scope).

Known limitation recorded for follow-up: the AnySearch adapter's
`parseSearchMarkdown` drops blocks with no `- **URL**` line, and `ip.global`
responses are frequently text-only. Retaining URL-less patent records needs
a provider-normalization change (result identity without a fabricated URL),
which is outside #24; the corpus avoids asserting hits on the affected
`ip.global` shape by using domain-only semantic rows.
