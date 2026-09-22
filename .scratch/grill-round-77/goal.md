# Grill Round 77 — Goal（定稿态）

Date: 2026-09-22. Ledger: `decision-ledger.md`（D-001~D-005 全 current）。定稿已获用户确认。

## 本轮主题（D-001，用户显式双轨裁决 A+B）

**「治理残账清算」双轨轮**：

1. **轨一**：dsh event-rename 观测哨再校准+到期演练。上游 2026-09-22 连发 `@deepseek-ai/dsh-agent` 0.1.5-rc.3（05:39）与 0.1.7-alpha.1（06:04）——registry cadence「per upstream release」→演练债到期；触发器锚定的 `0.1.6-rc.1` 或被 0.1.7-alpha 线跳越（0.1.6 仅 alpha.1/alpha.2）→观测哨语义漂移。
2. **轨二**：R76 审计显式 backlog 全量清算 7 项（同一失效类「gate 可因遗漏/误导而说谎」）。

## 裁决摘要（账本为准）

- **D-002**：轨一=L0/L1/L2 哨戒漏斗+respect-and-schedule（绝不绕龄期闸不开豁免）+特征/稳定性双锚触发器（版本号降为记录字段）+latest-only 配墓碑条目；ADR-0074 cadence 显式修订为「每版 L1 证据+留档，L2 只给采纳候选」。
- **D-003**：轨二 7 项同票——titleRound 误登记收紧/非数字 dir 显式化/coverage 红态压 leg-(a) 诊断序/canonical 锁空清单改 fail-closed/F-5⑥ parser↔render 耦合/F-5⑦ 锁条目补 sibling 字段（走 normalize=自食其锁）/F-6 BOM 报错教修 BOM；逐项红方向实测。
- **D-004**：T0 轨一探针取证（纯证据零源码）→T1 轨二清算→T2 文书收口；探针事实先于触发器措辞定稿。
- **D-005**：三段收口+L2 条件式排程（合格候选→dated scheduled obligation；无候选→显式结论）；ALARM 逐版本显式判定。

## 显式范围外（落选债原名续 deferred，T2 记显式续债条）

`defer-r71-transformers-undeclared-dep`（#1764 仍 OPEN）· `defer-r71-provider-serverside` · `defer-r72-dsh-*` 三件套 · `defer-r74-logo-bitmap-matrix`（imagegen 缺席）· `defer-r75-registerhooks-esm-arm`（trigger(c) 仅 Node 腿响）· `defer-f16` / `defer-f17` · `defer-anysearch-domain-ownership`。外发闸（drafts/pr-1764-comment.md+issue-1087-comment.md）=用户动作项非本轮题。绕龄期闸/版本号重锚/alpha 线例行 L2/per-dependency 豁免均显式否。

## 路径纪律自证

本目录全部文档 repo-relative；无机器绝对路径落档（探针 tarball/临时脚本均机器临时目录不提交）。

## 遗留呈报项（T2 收口时列入 handoff）

- `#1764` merge 观察哨续挂（2026-09-22 实查 OPEN，updatedAt 2026-09-03 起 19 天无动静）。
- 外发闸：两份评论文稿仍「待用户发」状态。
- L2 排程态（若有合格候选）须落 registry/ledger/handoff 锚点。
