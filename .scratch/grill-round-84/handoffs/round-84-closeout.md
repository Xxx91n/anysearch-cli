# Round-84 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-26):
`r84-grill` → `mzq`（账本 D-001~D-008+任务书+词表 10 词）；`r84-t1` → `mwo`（T1：A-02/A-04 立法+三入口 fail-fast+canonicalizeVertical+expected.vertical schema+stub 5 钉+ship-gate 在场断言）；`r84-t2`（叠于其上）→ `rty`（T2：57 live 语料+对照 18+hitHosts/hitPaths 测量池+活词表快照+T2b 首窗观测档）；`r84-t3` → `krs`（T3：配对 delta runner+ANS_ARM_SNAPSHOT/ANS_PROVIDERS eval 面+degraded 分类+ship-gate runner 锚）；`r84-t4` → `tlt`（ADR-0085+index 入册+registry 三联+CHANGELOG r84 条目）→ 收口报告+本交接。

主题：垂域评测证据腿——为「信息专精」主张建立可信测量机制（prefer-capable 挂账前置证据机）。

## 已完成

- **T0 哨戒续班**：dsh rc.2 闸窗过后复检+CI/llm-flake/#1764 观测档 → `evidence/t0-watch.md`。
- **T1 契约层+语义立法**：A-02 fail-fast 三入口统一（CLI/TOML 对齐 MCP 拒收报错）；A-04 `params:{}≡absent` 单点 `canonicalizeVertical`（contract.ts），engine 审计事件与 wire 边界共用；`expected.vertical` 断言键 schema 入库；stub 钉 5 条；offline 全绿。立法档 `evidence/t1-semantics-legislation.md`。commit `mwo`。
- **T2 语料构建**：57 条 live-scoped（finance/academic/code/health × parameterized/semantic）+ 对照类一等断言条目（垂域家族 62=57+5 stub）；provenance 全字段+建集期活词表快照 `evidence/sub-domains-vocab.json`（get_sub_domains 仅人工探查不进运行时）；`hitHosts`/`hitPaths` 测量池 schema（软测量面非门禁）。commit `rty`。
- **T2b query 侧事实**：消费 `retrieval.vertical.pre` 观测库实测——966 retrieval traces 中仅 2 条 vertical.pre（均 R83 手工验证），首窗稀薄如实记 `evidence/query-side-facts.md`。
- **T3 证据腿**：配对 delta runner `packages/store/test/online/eval-looks-vertical.online.ts`——每条带 spec 条目 4 趟（隔离臂 ON/OFF 主证 + 全扇出 ON/OFF 副列），产 `anysearch/vertical-delta@1` 证据件（`.scratch/vertical-eval/delta.json`）携 fingerprint+臂标识+显式 n+better/worse/tied/unknown+providersFailed 四面+臂 URL 采样；CLI env 门控 eval 面 `ANS_ARM_SNAPSHOT`/`ANS_PROVIDERS`；ship-gate runner 在场+锚断言。commit `krs`。
- **T3 实测结果（部分降格如实记）**：57 条×4 趟跑通全成对（parameterized 21/21、semantic 20/20、control 12 spec 携条成对）；前几条获真臂数据（`vert-f1101` ON 臂命中 `site.financialmodelingprep.com` verdict=better；f1102 tied；f1103 worse——垂域上游窄化返回 0-1 条聚合页 vs OFF 臂 10 条多样）；其后匿名额度耗尽两臂归零+`providersFailed:["anysearch"]` 显式失败——机制链绿、覆盖受配额限，重跑条件已登记。证据档 `evidence/t3-vertical-delta.md`。
- **T4 收口**：ADR-0085 八段（主题/契约双层/语料法/断言形制/测量范围/域选/前置语义立法/收口判据）+显式假设标注三则+interleaving 远期出口节；registry：prefer-capable 注记=「证据机制在役等数据」**open 不核销**+新增 defer-r84 三联；A-05 复核（pre 事件七键与 ADR-0084 对账=一致未扩张）；A-07 复核（evidence 命令 ./ 前缀面无变更=无操作复核行）；closeout-claims.json 10 条机验声明；CHANGELOG r84 条目；ADR index 0085 入册。commit `tlt`。

## 残留呈报

- 匿名配额窗口外 live 读数为部分降格——全量配对重跑待有效公网 key 或额度恢复（defer-r84-delta-quota-rerun）。
- `ANYSEARCH_ENDPOINT=""` 空串经 `??` 落空 endpoint 坑已登记未修（defer-r84-anysearch-empty-endpoint-env，清障轮候选）。
- 本机 `~/.anysearch/config.env` 持久化 `ANS_DOMAIN=docs`——域 allowlist 会把 anysearch 垂域结果全滤光（abstain domain_filter_empty）；eval 跑须显式 `ANS_DOMAIN=default` 覆盖（runner 已内建）。<!-- machine-local: 用户级持久化配置面（eval 环境陷阱呈报） @ 2026-09-26 -->
- 上游垂域返回可含 schemeless URL + 单一聚合页（host 后缀匹配已容错）；armInFanout 存活率低是优雅窗时序产物非故障。
- ANYSEARCH_ENDPOINT 用户配置域不录不代改；#1764 用户侧不代发。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。验收全为本地实录（命令+输出摘要见 reports/2026-09-26-report.md）。承继基线 run（head_sha=栈基祖先 acaaccb3）：

- https://github.com/Xxx91n/anysearch-cli/actions/runs/36084882610 —— ci success
- https://github.com/Xxx91n/anysearch-cli/actions/runs/36084882552 —— ship-gate success

## Rework 补记（2026-09-27 审计 REWORK → 已修）

审计 `reports/2026-09-27-audit.md`（r84-audit `yux`）判打回，两硬项已闭合：

- **F1**：composition catch 吞错形 TOML → 修 `Domain schema:` 族放行（缺域仍 fail-open）；kernel `composition-vertical.test.ts` 4 断言 + e2e 坏 TOML 用例在钉。
- **F2**：A-03/A-06/A-08 三条补登 deferred-registry（R83 审计素材入账）。
- **F3/F4** 记录不阻断：存量 delta.json 早期 schema 披露+f1101 归因改 rankDiff——见 t3 档 §3/§5 与报告 rework 节。
- 本交接原稿将「三入口对齐」按达成呈报——TOML 腿实测未对齐，过程违规属实，此处更正。

## 下一轮候选（详见 handoffs/next-round.md）

- **候选 A**：持有效 key 重跑 delta 腿取全量读数 → 数据读出后再评 prefer-capable。
- **候选 B**：empty-endpoint 清障轮 + ip 第五域触发观察。
- **候选 C**：征集下一轮主题。
