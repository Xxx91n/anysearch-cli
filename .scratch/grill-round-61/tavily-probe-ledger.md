# Tavily include_domains probe ledger (ADR-0062 criterion 5)

ranAt: 2026-09-14T10:35:20.554Z | key: unset

| arm | status | summary |
|---|---|---|
| A-default-mode | SKIPPED | TAVILY_API_KEY unset - live arm not run |
| B-filter-mode | SKIPPED | TAVILY_API_KEY unset - live arm not run |
| C-subdomain-direction | SKIPPED | TAVILY_API_KEY unset - live arm not run |
| D-research-endpoint | SKIPPED | TAVILY_API_KEY unset - live arm not run |

Re-run: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs (PROBE_TAVILY_RESEARCH=1 enables arm D).
