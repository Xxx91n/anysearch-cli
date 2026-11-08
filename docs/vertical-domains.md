# AnySearch vertical domains — what the upstream accepts

This page is a snapshot taken on a given date. The live authority is the
upstream `get_sub_domains` tool (queried 2026-09-25 and updated for `ip` on
2026-11-07, `https://api.anysearch.com/mcp`). The client does not ship a copy
of the enum.

The client checks the shape only (non-empty strings / Record). A bad
`sub_domain` value, or a missing required `sub_domain_params`, comes back as
an upstream `isError`. The anysearch provider fails with an error. It never
returns an empty result that looks like a normal search.

These are the 17 top-level domain values (the enum on `search.domain`):

`academic` `agriculture` `business` `code` `energy` `environment`
`film` `finance` `gaming` `general` `health` `ip` `legal` `resource`
`security` `social_media` `travel`

What the upstream did (live probe 2026-09-25):

- `sub_domain` values such as `finance.calendar` / `finance.fundamental` come
  from `get_sub_domains(domain=<d>)`, together with a parameter table for each
  tag. For example, `finance.calendar` requires `type` ∈
  earnings|dividends|ipos|economic; `finance.fundamental` requires `type` plus
  `symbol` or `cn_code`, depending on the type.
- A `domain` value outside the enum is accepted without an error. It falls
  back to a general-style result set. Errors come from the `sub_domain` and
  the params, not from the domain value.
- `domain` alone, with no `sub_domain`, still returns results. The docs call
  `sub_domain` "required", but the server does not enforce it.

What the upstream did — `ip` update (live probe 2026-11-07):

- `ip.global` is the only `ip` sub-domain. It gathers global patents and
  traces patent families through EPO DOCDB/INPADOC (100+ countries with legal
  status). Its parameters are `type` (e.g. `GlobalPatent`), `keyword`,
  `applicant`, `ipc` (IPC/CPC class, e.g. `H01L`), and `date_start`
  (`YYYYMMDD`). The full probe output is in
  `docs/eval/ip-corpus-probe-2026-11-07.md`.
- This table was taken when the eval corpus was built. It is not a runtime
  list. The client still checks the shape only. The `ip` names appear in the
  eval corpus and its `vdomain` slice tag, not in the shipped routing code.
- `ip` with no `sub_domain` returns general web results, the same silent
  fallback as every other domain. An unknown `ip` sub-domain returns
  `isError` (`Invalid tag: ip.<value>`). An unknown `type` *value* is accepted
  silently (no `isError`).
