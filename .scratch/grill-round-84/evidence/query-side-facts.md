# T2b query 侧事实收集 — retrieval.vertical.pre 首窗观测（2026-09-26）

数据源：本机观测库 `~/.anysearch/anysearch.db` 表 `observability_spans` <!-- machine-local: 本机用户级观测库路径（首窗事实源） @ 2026-09-26 -->
（events_json 承载 span 事件；trace 关联 `observability_traces`）。

## 首窗口径与数字（复跑命令附后）

- 观测窗口：2026-09-13T20:03:29Z → 2026-09-26T12:23:47Z（约 13 天）。
- retrieval 类 trace 总量（ans.search + search_web + research_web）：**966**。
- `retrieval.vertical.pre` 事件 trace 数：**2**（垂域流量占比 ≈ **0.21%**）。
- 两条事件均为 2026-09-25 15:50-15:51 UTC 的 R83 人工验证查询：
  - `anysearch.vertical.domain=finance, sub_domain=calendar, params_keys=["type"], source=query, sent=["anysearch"], degraded=["tavily"]`
- sub_domain 覆盖：仅 finance.calendar 被实测；其余 15 个 sub_domain
  （finance 另 5 + academic 5 + code 2 + health 3）零自然触达。

## 判读（如实记录，不外推）

1. **垂域流量首窗稀薄**：0.21% 且全部来自开发验证而非自然使用——
   印证 D-003「不等真实流量先建集」的裁决必要：靠自然流量建语料在本窗口
   事实不可得。
2. **词表覆盖真空**：finance 之外三域零观测——语料构建因此必须以
   词表快照（sub-domains-vocab.json）+构建式条目覆盖，覆盖率=构建覆盖。
3. **不产生零记为 unknown**：本窗数据显示"未知域是否有效"不可由流量
   回答——断言键与 delta 证据承担该测量职责。

## 复跑命令

<!-- machine-local: 本机用户级观测库路径（复跑命令块统一声明） @ 2026-09-26 -->
```bash
sqlite3 ~/.anysearch/anysearch.db \
  "SELECT COUNT(*) FROM observability_spans WHERE events_json LIKE '%retrieval.vertical.pre%';"
sqlite3 ~/.anysearch/anysearch.db \
  "SELECT operation, COUNT(*) FROM observability_spans GROUP BY operation;"
sqlite3 ~/.anysearch/anysearch.db \
  "SELECT events_json FROM observability_spans WHERE events_json LIKE '%retrieval.vertical.pre%' LIMIT 5;"
```

## 采集通道在册

事件发射点：`packages/kernel/src/engine.ts`（retrieval.vertical.pre，
查询级/仓级 source 判定 + sent/degraded 名单 + params_keys 键名集）。
采集器：`packages/store/src/observation.ts` recordOperation →
observability_spans.events_json 持久化。本档即"采集通道在册"证据。
