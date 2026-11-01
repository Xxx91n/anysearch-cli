# AnySearch vertical domains — vocabulary snapshot

The vocabulary and constraint notes below are a **dated snapshot** — the
live authority is the upstream `get_sub_domains` tool (queried 2026-09-25,
`https://api.anysearch.com/mcp`); the client intentionally ships no enum
copy. Local validation checks *shape only* (non-empty strings / Record) —
invalid `sub_domain` or missing required `sub_domain_params` come back as
upstream `isError`, which degrades the anysearch arm fail-first (never a
silent zero-result envelope).

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
