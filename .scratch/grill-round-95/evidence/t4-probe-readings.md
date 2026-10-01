# R95 T4 — 匿名层容量探针读数（证据档，非判读输入）

日期: 2026-10-01 | runner: `packages/store/test/online/eval-looks-vertical.online.ts` | `ANS_VERTICAL_DELTA_LIMIT=4`

## 执行事实

- 覆写：`ANYSEARCH_ENDPOINT=<公开 MCP 端点>` + `ANYSEARCH_API_KEY=""`（空 key→匿名；本机 env 原值实测 `http://127.0.0.1:20128/v1/search` 死回环 + 非空无效 key，见 goal.md）。
- **attempt1**（`probe-limit4-attempt1-badendpoint.json`，sha256 `3b15e14aa1b8d774599441f548b54e50f491fe58bd5d8bce4c94f5e2cf625381`）：端点按任务书速记写成裸 origin → provider `initialize HTTP 404 Not Found`（分类 permanent-protocol，实为端点路径缺失）。根因：`normalizeEndpoint` 仅重写 `/v1/search` 旧后缀，裸 origin 原样透传（`packages/retriever/src/providers/anysearch.ts:44-56`）。**执行级修正：须给完整 MCP 路径 `/mcp`**——记档回报。
- **attempt2**（`probe-limit4-delta.json`，sha256 `e1d4f7d83aa9f88c2f97a9e30971f3db7171e8e5c843929c81c9d17b75ba8310`）：n=4 / paired=4 / unknown=0 / 零 DEGRADED / 零 instrumentFlag；16 调用（4 格×4 腿）耗时 84s。
- 单发对照（provider 探针，`--nokey` 同端点）：`ok:true`，3 results，elapsed 4525ms（server 1395ms）。
- raw MCP 匿名直连（`scripts/probe-anysearch-mcp-raw.ts --default-endpoint --nokey`）：HTTP 200，`## Search Results (10 results, 1329ms)`。

## 容量读数

- 持续吞吐（并发 4）：≈5.25s/腿 → ~0.76 腿/s；无 nudge、无退化 → 按预注册判定「余量足 → 同窗全量」。
- 登记为容量测量，非判读输入（prereg §3 探针/终读二分条款）。
