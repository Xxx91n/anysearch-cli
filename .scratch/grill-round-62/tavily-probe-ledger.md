# Tavily include_domains probe ledger (ADR-0062 criterion 5)

ranAt: 2026-09-14T19:11:54.483Z | key: set

| arm | status | summary |
|---|---|---|
| A-default-mode | PASS | 0/10 results outside include_domains (default mode) |
| B-filter-mode | PASS | 0/10 results outside include_domains (filter mode) |
| C-subdomain-direction | PASS | parent hosts=["www.typescriptlang.org"] sub hosts=["www.typescriptlang.org","typescriptlang.org"] parentCoversSub=true subPullsParent=true |
| D-research-endpoint | INCONCLUSIVE | 0 url fields in /research response (keys: status,input,model,created_at,response_time,request_id) — vacuous, response shape needs review |

Re-run: TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs (PROBE_TAVILY_RESEARCH=1 enables arm D).
