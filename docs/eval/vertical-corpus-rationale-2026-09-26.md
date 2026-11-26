# Vertical corpus rationale — 2026-09-26

This file is the evidence for ticket **#656** under spec **#643** (section E). It backs 36
corpus entries: the 20 semantic entries
`vert-{f,a,c,h}1201`–`1205` and the 16 control entries `ctrl-{f,a,c,h}101`–`104`. The raw
text was recovered from `0f1148ca`, where it lived in
`.scratch/grill-round-84/evidence/corpus-rationale.md`; that path is not in a clean
checkout. The corpus refs still point at those old paths; ticket #665 repoints them at this
file.

The ADR layer was removed in `5593fe05`. The ADR numbers and `D-xxx` decision ids below are historical names, not
links that still resolve.

## Trigger

The four-domain corpus needed a written reason for the domain choice, the three-layer shape
and the size arithmetic, so that a later reader can check each entry against a rule instead
of guessing why it is there. This is that record. The 21 parameterized entries that sit in
the same four domains draw their word table from
`docs/eval/sub-domains-vocab-2026-09-26.json`; this card does not repeat it.

## Method

- Date: 2026-09-26.
- No endpoint, no request body, no key: this was written before the entries as the
  construction rule, not captured from a live probe.
- Read-only: the text is copied as found. No runtime code was changed.

## Raw

### 域选择理由（D-006 记录）

四域选型与账本一致：**finance / academic / code / health**。理由：

- 四域皆为 upstream `get_sub_domains` 实测有结构化 sub_domain 的域
  （finance 6 / academic 5 / code 2 / health 3——2026-09-26 活词表快照
  `sub-domains-vocab.json`），参数化层有真参数可断言。
- 域间语义异质（金融数据型/文献型/工程型/医药型），覆盖差异化召回面，
  支撑「信息专精」质量证据的域间一致性检验。
- `ip` 域上游 sub_domain 参数表当前未提供结构化表单字段——按 D-006
  登记为条件第五域候选（上游给出结构化参数时启用），本轮不入集。

### 分层结构（每域同形）

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

### 规模核算

- live 语料：41 subject + 16 control = 57 条；stub 契约钉 5 条。
- R84 垂域家族合计 62 条（∈60-70 目标带）；账册总计 14 docs + 62 = 76 条。
- 每域 14-15 条（∈12-17 带）。

### provenance 与诚实规则

- 全部条目 `provenance.type=constructed`（人工/代理撰写），`reviewer`
  必填，`ref` 指向本档或词表快照（revisitable）。
- LLM 辅助未用（constructed 路径自足）；若后续引入辅助起草，必须跨家族
  模型 + `type=llm-assisted` + `audit` 指向起草痕迹。
- 稀疏分层如实保留：code 域仅 2 sub_domain（参数化面天然薄）——不删层、
  在 notes 记覆盖实况。
- `hitHosts`/`hitPaths` 是测量池（any-of 软测量面，喂 delta 命中率），
  不进 live 红门——上游 host 混合漂移是证据不是破损。

## Evidence table

| entries | assertion | what supports it |
|---|---|---|
| `vert-f1201`–`vert-f1205` | A domain-only finance query answers inside the vertical and hits at least one measured host. | 分层结构: `semantic` is five per domain. 域选择理由: finance has 6 sub_domains, the widest parameterized table, and a data-shaped recall surface. |
| `vert-a1201`–`vert-a1205` | A domain-only academic query answers inside the vertical and hits at least one measured host. | 分层结构: `semantic` is five per domain. 域选择理由: academic has 5 sub_domains and a literature-shaped recall surface. |
| `vert-c1201`–`vert-c1205` | A domain-only code query answers inside the vertical and hits at least one measured host. | 分层结构: `semantic` is five per domain, and a sparse parameterized layer is kept, not deleted. 域选择理由: code has only 2 sub_domains, so this layer carries the domain. |
| `vert-h1201`–`vert-h1205` | A domain-only health query answers inside the vertical and hits at least one measured host. | 分层结构: `semantic` is five per domain. 域选择理由: health has 3 sub_domains and a medical-shaped recall surface. |
| `ctrl-f101`, `ctrl-a101`, `ctrl-c101`, `ctrl-h101` | With no vertical spec, the result carries no vertical marker. | 分层结构: 域外无 spec `hit:false` pins the false-label case. |
| `ctrl-f102`, `ctrl-a102`, `ctrl-c102`, `ctrl-h102` | A vertical spec on an off-domain question still answers from general results (`general-fallback`). | 分层结构: 错配 spec exists to prove the silent-fallback surface exists. |
| `ctrl-f103`, `ctrl-a103`, `ctrl-c103`, `ctrl-h103` | A bogus sub_domain is rejected upstream; the vertical arm fails first and general arms answer. | 分层结构: bogus sub_domain, cross-checked against the `### Upstream checks` table in
`docs/eval/vertical-domain-contract-2026-09-25.md`. |
| `ctrl-f104`, `ctrl-a104`, `ctrl-c104`, `ctrl-h104` | An ambiguous query falls back to general results, giving the disambiguation delta baseline. | 分层结构: 歧义查询 is the delta measurement baseline. |

## Scope

- Provenance only: no runtime code changes, no corpus entry is added, and the entries are
  not re-run here.
- The word table lives in `docs/eval/sub-domains-vocab-2026-09-26.json`. This card states
  the rules and leaves the table where it is.
- `hitHosts` is a measurement pool, never a live pass rule: any one host in the list counts,
  and the upstream mix drifting is evidence, not breakage.
- The source ended with a process note that pointed at `query-side-facts.md` for the query
  side. That record still lives only in `0f1148ca` and is not part of these 36 entries, so
  the note is not copied and this card does not promise it.
- The `.scratch/...` path above is historical. This file is where its text lives now.
