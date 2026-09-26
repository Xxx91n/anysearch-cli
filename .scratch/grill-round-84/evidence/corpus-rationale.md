# T2 语料构建原则与域选择理由（D-003/D-006 入档）

## 域选择理由（D-006 记录）

四域选型与账本一致：**finance / academic / code / health**。理由：

- 四域皆为 upstream `get_sub_domains` 实测有结构化 sub_domain 的域
  （finance 6 / academic 5 / code 2 / health 3——2026-09-26 活词表快照
  `sub-domains-vocab.json`），参数化层有真参数可断言。
- 域间语义异质（金融数据型/文献型/工程型/医药型），覆盖差异化召回面，
  支撑「信息专精」质量证据的域间一致性检验。
- `ip` 域上游 sub_domain 参数表当前未提供结构化表单字段——按 D-006
  登记为条件第五域候选（上游给出结构化参数时启用），本轮不入集。

## 分层结构（每域同形）

- **parameterized**（sub_domain+params 最强信号）：finance 6 / academic 5 /
  code 5 / health 5 = 21 条。params 一律取词表快照中已验证合法值
  （required 参数全齐，避免 isError 非目标变量污染）。
- **semantic**（domain-only 垂域语义查询）：每域 5 条 = 20 条。
- **control**（对照类一等断言类）：每域 4 条 = 16 live + ctrl-0001/0002
  stub 钉 2 条 = **18 条**（≥12-15 达标）。四类控制覆盖：
  - 域外无 spec（hit:false 钉「无误标」）；
  - 错配 spec（垂域 spec + 域外问题 → 静默回退面存在性）；
  - bogus sub_domain（上游 isError 拒收面，对照 2026-09-25 实测矩阵）；
  - 歧义查询（歧义消歧质量 delta 测量基线）。

## 规模核算

- live 语料：41 subject + 16 control = 57 条；stub 契约钉 5 条。
- R84 垂域家族合计 62 条（∈60-70 目标带）；账册总计 14 docs + 62 = 76 条。
- 每域 14-15 条（∈12-17 带）。

## provenance 与诚实规则

- 全部条目 `provenance.type=constructed`（人工/代理撰写），`reviewer`
  必填，`ref` 指向本档或词表快照（revisitable）。
- LLM 辅助未用（constructed 路径自足）；若后续引入辅助起草，必须跨家族
  模型 + `type=llm-assisted` + `audit` 指向起草痕迹。
- 稀疏分层如实保留：code 域仅 2 sub_domain（参数化面天然薄）——不删层、
  在 notes 记覆盖实况。
- `hitHosts`/`hitPaths` 是测量池（any-of 软测量面，喂 delta 命中率），
  不进 live 红门——上游 host 混合漂移是证据不是破损。

## query 侧事实（T2b 联动）

`retrieval.vertical.pre` 首窗观测数据由 T2b 收集；本档预留回填行：
首窗实测占比/sub_domain 分布见 `query-side-facts.md`。
