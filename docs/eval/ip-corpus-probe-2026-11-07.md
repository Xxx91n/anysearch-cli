# ip domain probe — 2026-11-07

This file is the evidence for ticket **#24** (the ip fifth-domain corpus) under spec **#203**
(T12). The corpus entries `vert-i11xx` / `vert-i12xx` / `ctrl-i10x` in
`eval-looks.json` point to this file as their source.

## Trigger

The original deferred-registry entry said the corpus work can start "as soon as the probe prints a
parameter table we can use". This probe shows that moment has arrived:
`get_sub_domains(domain="ip")` now returns a table of per-parameter definitions, the same
shape the `finance.*` entries already produce.

## Method

- Endpoint: `https://api.anysearch.com/mcp` (Streamable HTTP MCP).
- Request path: `initialize` (protocol `2025-03-26`, no `mcp-session-id`
  response header) → `notifications/initialized` → `tools/list` →
  `tools/call get_sub_domains {domain:"ip"}` → `tools/call search` samples.
  The two `tools/call` request bodies were:

  ```json
  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_sub_domains","arguments":{"domain":"ip"}}}
  ```

  ```json
  {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search","arguments":{"query":"solar cell patents","domain":"ip","sub_domain":"ip.global","sub_domain_params":{"type":"GlobalPatent","keyword":"solar cell"}}}}
  ```

- Date: 2026-11-07. An API key was present; the key is never written down here.
- Read-only: the probe only calls `get_sub_domains` and `search`. Nothing in the
  runtime was rewired.

`tools/list` returned `batch_search`, `extract`, `get_sub_domains`, `score`,
`search` — the same five names already noted as upstream drift; this repo only
uses `search`.

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
parameters. `type` picks the result shape; the other four filter it.

## Search-shape matrix

All calls used `domain: "ip"` (plus `sub_domain` / `sub_domain_params` where
shown) and read the upstream markdown reply. The counts are the header counts
of the `## Search Results` block.

| Case | `isError` | Result count | URL hosts in reply |
|---|---|---|---|
| domain only (no sub_domain) | absent | 10 | general web news (`elecfans.com`, `mydrivers.com`, `cnbeta.com`, `sgpjbg.com`, …) |
| `ip.global`, no params | absent | 9 | none — patent records are text-only |
| `type=GlobalPatent` | absent | 10 | `worldwide.espacenet.com` |
| `keyword=solar cell` (no type) | absent | 10 | `analytics.patsnap.com`, `worldwide.espacenet.com` |
| `type=GlobalPatent`, `ipc=H01L` | absent | 10 | `worldwide.espacenet.com` |
| `type=GlobalPatent`, `date_start=20200101` | absent | 10 | `worldwide.espacenet.com` |
| `type=GlobalPatent`, `applicant=Huawei`, `date_start=20230101` | absent | 7 | none — text-only |
| `type=bogus_type` | absent | 8 | none — an unknown type value is quietly accepted |
| `ip.bogus_xyz` | **true** | — | `Invalid tag: ip.bogus_xyz.` |

How the corpus uses this:

- The `hitHosts` measurement lists are `espacenet.com` and `patsnap.com` (suffix
  matching covers `worldwide.espacenet.com` / `analytics.patsnap.com`). All
  five parameterized entries define `hitHosts`, and `hitPaths` is `/patent/`
  where URL lines were seen.
- The semantic entries use `{domain:"ip"}` (domain only), matching the
  finance/academic/code/health semantic group. We tried a bare
  `ip.global` spec first, but its replies are often text-only (no
  `- **URL**` line). `parseSearchMarkdown` drops blocks without a URL, so a
  `hit:true` check would see nothing and the live test would fail. Keeping
  text-only records is a provider-normalization task outside this corpus
  ticket. Domain-only `ip` returns general results that do carry URLs, so the
  vertical marker and hit rules stay testable. Its `hitHosts` lists come from
  the 2026-11-07 domain-only samples (relevant hosts such as
  `iam-media.com`, `mondaq.com`, `patsnap.com`, `patents.google.com`). A list
  is a measurement candidate, never a hard pass rule.
- A wrong `ip` sub-domain is rejected upstream; that is the surface
  `ctrl-i103` locks. A wrong `type` *value* is not rejected, so no control
  expects an error for it.
- Domain-only `ip` quietly falls back to general web search (the
  `ctrl-i102` / `ctrl-i104` surfaces), just like the other domains.

A second probe (2026-11-07, same endpoint) covered the rows that stay
parameterized:

| Case | Result count | `- **URL**` lines |
|---|---|---|
| `type=GlobalPatent`, `applicant=Huawei` | 10 | 3 (`worldwide.espacenet.com`) |
| `type=GlobalPatent`, `applicant=Huawei`, `keyword=5G` | 10 | 3 (`worldwide.espacenet.com`) |
| `type=GlobalPatent`, `applicant=BYD`, `keyword=solid-state battery`, `date_start=20220101` | 10 | 8 (`worldwide.espacenet.com`) |
| domain-only `ip` (TSMC / FRAND questions) | 10 | 10 (general web hosts) |

## Scope

This snapshot is only for building the eval corpus. It does not add an `ip`
sub-domain enum to the runtime adapter, and `get_sub_domains` is still not
connected as a shipped tool (spec #203 Out of Scope).

Known limitation left for later: the AnySearch adapter's
`parseSearchMarkdown` drops blocks with no `- **URL**` line, and `ip.global`
replies are often text-only. Keeping URL-less patent records needs a change in
how the provider normalizes results (giving a result an identity without
inventing a URL). That is outside #24; the corpus avoids asserting hits on the
affected `ip.global` shape by using domain-only semantic rows.
