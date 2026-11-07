# AnySearch vertical domains — vocabulary snapshot

The vocabulary and constraint notes below are a **dated snapshot** — the
live authority is the upstream `get_sub_domains` tool (queried 2026-09-25 and
supplemented for `ip` on 2026-11-07, `https://api.anysearch.com/mcp`); the
client intentionally ships no enum copy. Local validation checks *shape only*
(non-empty strings / Record) — invalid `sub_domain` values or missing required
`sub_domain_params` produce an upstream `isError`; the anysearch arm uses
fail-first degradation (never a silent zero-result envelope).

The 17 top-level domain values (enum on `search.domain`):

`academic` `agriculture` `business` `code` `energy` `environment`
`film` `finance` `gaming` `general` `health` `ip` `legal` `resource`
`security` `social_media` `travel`

Observed upstream semantics (live probe 2026-09-25):

- `sub_domain` values like `finance.calendar` / `finance.fundamental` come
  from `get_sub_domains(domain=<d>)` output along with per-tag param tables
  (e.g. `finance.calendar` requires `type` ∈ earnings|dividends|ipos|economic;
  `finance.fundamental` requires `type` plus `symbol` or `cn_code` per type).
- An out-of-enum `domain` is silently tolerated upstream (falls back to a
  general-style result set) — rejection pressure lives on the sub_domain and
  params side, not the domain enum itself.
- `domain` alone (no `sub_domain`) returns results; docs call sub_domain
  "required" but the server does not enforce it.

Observed upstream semantics — `ip` supplement (live probe 2026-11-07):

- `ip.global` is the only `ip` sub-domain. It aggregates global patents and
  traces families via EPO DOCDB/INPADOC (100+ countries with legal status).
  Its parameter table is `type` (e.g. `GlobalPatent`), `keyword`,
  `applicant`, `ipc` (IPC/CPC class, e.g. `H01L`), `date_start`
  (`YYYYMMDD`). Full probe output: `docs/eval/ip-corpus-probe-2026-11-07.md`.
- The table is a **corpus-construction snapshot**, not a runtime enum — the
  client still validates shape only; the `ip` vocabulary appears in the eval
  corpus and its `vdomain` slice tag, not in the shipped routing code.
- `ip` with no `sub_domain` returns general web results (the same silent
  fallback as every other domain); an unknown `ip` sub-domain returns
  `isError` (`Invalid tag: ip.<value>`). An unknown `type` *value* is
  tolerated silently (no `isError`).
