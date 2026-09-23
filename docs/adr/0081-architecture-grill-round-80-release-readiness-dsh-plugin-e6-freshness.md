# ADR-0081: Grill Round 80 — 发布就绪轮（dsh-plugin 上架备货 + E6 lockfile 复核腿实证收口 + 派生件新鲜度腿 + 上游哨戒）

## Status

Accepted (release-readiness round r80, ships as 0.0.8). Records the round-80
decisions per the serial ticket plan T0–T4. Ledger:
`.scratch/grill-round-80/decision-ledger.md` (D-001~D-005, 无断号).
Evidence root: `.scratch/grill-round-80/evidence/`.

## Context

0.0.8 是本轮凝聚轴：同一 pass/fail 发布面四腿同时落地——(i) dsh-plugin
自 R72 起 `private:true` 积压两轮未上架（defer-r72-dsh-plugin-npm-publish）；
(ii) R78 E6 证伪实录称「lockfile 回放静默放行 minimumReleaseAge」，
与上游文档级断言（pnpm 11.1.3+ verifyLockfileResolutions 复核腿）存在
未解张力，执法空白未定案（defer-r79-lockfile-agegate-replay）；(iii)
派生件（CHANGELOG/报告/交接内声明）与实物存在新鲜度覆盖缺口——R78
审计 F-1「CHANGELOG 缺轮次条目」为真事先例；(iv) dsh 上游 rc.3/alpha
线连续出新，双锚哨戒义务续挂（defer-r73-dsh-event-rename）。

## Decision

### D1 主题定界——发布就绪四腿一轴（D-001/D-002）

R80 = 发布就绪轮，非发布轮。五票序 T0→T4，票间禁跨改（T1 不动产品面 /
T2 不动闸面 / T3 不动发布面）；npm publish / git tag / 外发 drafts 全部
用户扳机。γ 条件阻塞语义（D-002 账本权威，三可核验条件全部命中方阻塞
0.0.8）：(a) lockfile 在册已含闸内未成熟版本；(b) 回放可投毒构建产物；
(c) trustLockfile 验证腿实测不覆盖且补偿控制失效。

### D2 T0 上游哨戒——双锚裁决续挂（D-002 骑缝）

观测窗 @ 2026-09-23T10:11:30Z：`@deepseek-ai/dsh-agent` 三版闸态
rc.3/alpha.1/alpha.2 全部闸内（出闸 ≈09-24 05:39/06:04/15:50Z）；
alpha.2 携特征锚（`agent/created` payload 增 `source`/`signal`，
`agent/session-start` 缺席）但处 alpha 线——特征锚齐、稳定锚缺
（rc/stable 未达 + changelog 未审）→ 非 L2 合格候选，action=none。
`huggingface/transformers.js#1764` OPEN 趋僵（updated 09-03）续观察哨。
证据：`evidence/t0-watch.json` + `t0-watch-rc3-alpha1.md`。

### D3 E6 闸内执法裁决——三选一取 (b) 引用上游（D-002 γ 判定）

**实测结论（钉版 pnpm 11.24.0 实证矩阵，`evidence/e6-matrix.md`）**：
上游机器腿真实闭合——`pnpm install --frozen-lockfile` / 非 frozen
install（CI 同款 `--ignore-scripts` 路径）/ `pnpm fetch` /
`verifyDepsBeforeRun:install` 四路对移植污染 lockfile 全部
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` exit 1 拦截。

**R78 E6 证伪 revised**：当年五变体放行非缺腿，是 verdict 缓存污染——
`pnpm-cache/lockfile-verified.jsonl` 按 lockfile-hash+policy 指纹
（不含 strict）缓存判定；宽松写入（strict:false）的 warn-pass 判定被
同机回放沿用（A1/A2 格实证；全新 --cache-dir 强制重验即拦，A4 格）。

**残余边界三态**（诚实记档）：同机宽松写入沿用（写入机本机）；
`trustLockfile:true` opt-out 整腿跳过（B-tl 格实证）；
`Already up to date` 零作业短路不验（A3 格，无新内容落盘无害）。

**γ 判定**：(a) 未命中——在册 lockfile 全量成熟（rc.2 族 09-10 发布）；
(b) 未命中——回放拦截实证，且 dsh 族为 type-only devDep 不入产物；
(c) 未命中——验证腿实测覆盖。**γ 未触发 → 不阻塞。**

**裁决 (b) 引用上游 → 记档核销**：放行依据=上游机器腿闭合
（11.1.3+/PR #11583 + trustLockfile 默认 false）；例外记档降级为
**CI 断言依赖声明**——ship-gate 1v 三禁项 fail-closed（
`trustLockfile:true` / `minimumReleaseAgeStrict:false` / 非空
`minimumReleaseAgeExclude` / 增列 `IgnoreMissingTime:true`），
任一出现即重开向量，静态断言兜死残余边界中的配置面。

### D4 T2 产品备货——预首发路径立法（D-003）

`@anysearch-cli/dsh-plugin`：`private:false` +
`publishConfig {access:public, provenance:true}`；release.yml pack 循环
+ publish glob 清单接入第五包（4→5）；dependencies:{} 不变量不破
（churn lint 1s 断言同构更新为 publish-ready 形状）。

**预首发四步**（OIDC 要求包先在 npm 存在——0.0.3 手发先例 codify）：
1. 用户手发 `@anysearch-cli/dsh-plugin@0.0.7`（publish-ready 0.0.7
   commit 或本轮验证过的 tarball——真实版本非占位壳）；
2. npmjs 包页配 Trusted Publisher 四字段（owner/repo/workflow/env 空）
   + **2026-05-20 起显式 allowed actions 勾 `npm publish`**；
3. 推 `v0.0.8` tag → 五包统一 OIDC+sigstore provenance；
4. `npm view dist.attestations` + 装跑冒烟。

**no-go 分支**：首发/TP 未就绪 → tag 顺延，不拆发布清单（临时摘包=
清单漂移风险），不产占位壳。

**provenance 边界注**（Miasma 教训，写入 publishing.md）：sigstore
provenance 证明 **origin**（构建出处：repo/workflow/ref），不证明
**integrity**（源码未被改/产物与审阅一致）——是归因信号非防篡改封条。

### D5 T3 新鲜度腿设计——gate-the-merge 道（D-004）

ship-gate step-1 家族新腿 1u/1v（工程 commit nvo）：

- **CHANGELOG 当前轮条目断言**（fail）：锚 = `.scratch/grill-round-<N>`
  最大轮次号 → CHANGELOG `## ` 头须携 `r<N>` token；
- **豁免字段** `no-changelog-entry: <reason>`（goal.md 行解析）：
  缺字段→须条目；字段在 reason 空→fail；非空→pass-exempt；
- **closeout-claims.json 注册面**（schema `anysearch/closeout-claims@1`）：
  count（带推导命令，重推导比对）/ path / symbol / field 四 kind
  fail-closed，narrative kind warn 起步（升 fail 评审定 r82）；
  声明与推导命令同一 diff 变更由 schema 强制（count 缺 command 即 fail）；
- **只锚最新轮**：历史轮不回溯棘轮；注册面缺席 warn（pre-r80 宽容）。

**先例分级诚实标注**：「声明再推导」（re-derive declared counts/symbols
at gate time）= fitness-function（可执行适应度函数）与 executable-
documentation（文档即测试）的**推理级组合**，非任一成熟规则的直接套用——
结构同构先例有 docs-as-tests / ADR fitness functions，本仓细则
（轮次锚/豁免字段/分层分档）为自有立法。

**审计红 commit 工序例外注记**（任务书 T4.5(iii) 要求项；r80-audit F-A
补录）：红向 fixture 的合法载体=`临时 commit → 真门跑 → but undo`——
fixture 变异必须以 commit 形态进树（clean-tree 不变量不接受脏树跑门），
再用 `but undo` 撤出演示 commit 不留史。**锚点勘误**：任务书所引
`ADR-0074 rewrite-map` 经全文核对不存在（q5 调研夸大断言，atomcode
取证信任边界案例——外部调研结论一律实物复核后落文）；真实先例锚=
r72/r78 轮红向实录与本伦 `evidence/freshness-leg-dogfood.md` 七格
（F1–F4 初轮 + F5–F7 审计逃逸形）。该工序为例外许可：仅限 fixture
红向验证场景，产物须随证据归档，undo 后 `git status --porcelain`
必须回零——其余场景修=另 commit 的红线不变。

**棘轮表述**：豁免基线**只缩不增**——新增豁免形态（新豁免字段/新 warn
类）须 ADR 修订方可引入；注册面信号一旦注册不得静默摘除（摘除=声明
失配 fail）；回归破津贴（断言从 fail 降 warn/豁免域扩大）=stop-everything
级回退事件。注：本段禁用「冻结」措辞——基线可经 ADR 修订单向收缩，
非不可变。

### D6 Rejected alternatives

- **(a) 自建 E6 护栏（R81 顺延）**：自研 lockfile 复核脚本——否决：上游
  机器腿实测闭合，自研重复造轮子且语义更难对齐上游演进（原子裁决
  依据=e6-matrix 全格实录）。
- **(c) 显式记档时限例外**：γ 未触发，五要件例外无必要（若 γ 触发，
  例外五要件=策略引用/实质理由/已验补偿控制/具名接受人/≤90 天到期
  +复验触发器——形留存档备用）。
- **发布清单条件化**（TP 未就绪则临时摘 dsh-plugin 出清单）：否决——
  tag 时清单手术是红发布流水线根因模式（v0.0.5 双盲前科），顺延优于
  漂移。
- **新鲜度腿做 release-gate hook 或独立自检脚本**：否决——需求面是
  gate-the-merge 合并闸；release-gate hook 与门禁外自律脚本明确出范围
  （D-005）。
- **新鲜度断言放 step 2+**：否决——step-1 家族是静态断言同构位
  （ADR-0059~0077 全部先例），晚置徒增失败时延。

### D7 T4 文书收口判据（D-005）

三段收口：取证段（T0/T1 evidence+结论行+观测窗口戳）、就绪段（pack 拆验
+plugin add+dump-config+release.yml diff 评审+install 无脏）、文书段
（本 ADR+registry 更态+CONTEXT 词核查+用户动作清单+报告可复跑证据）。
WORKFLOW.md §4.2 缺位第 8 次核销——GitButler skill+全局 but 协议等价
覆盖（r73-r79 连续先例），如实记档不虚构。

## Consequences

- `@anysearch-cli/dsh-plugin` 成为第五发布包：v0.0.8 tag 起 OIDC 五包
  统一；首发前提=用户手发 0.0.7+TP 配置（清单见 publishing.md 首发节）。
- E6 lockfile 回放龄期执法=上游机器腿闭合+CI 断言依赖声明（ship-gate
  1v）双层；`defer-r79-lockfile-agegate-replay` 核销 closed_by ADR-0081；
  R78 E6 证伪记档态按本轮实测 revised（机制=verdict 缓存污染）。
- ship-gate 增两 leg：1u 新鲜度腿（CHANGELOG 断言+豁免+注册面）+1v E6
  闸断言；新腿自证=4 fixture 红绿对+本 dogfood 实录
  （`evidence/freshness-leg-dogfood.md`）。
- 用户动作五项（外发均为用户扳机）：手发 dsh-plugin@0.0.7 → npmjs TP
  四字段+allowed actions 勾选 → 推 v0.0.8 tag → 外发 #1764 评论草稿
  → 外发 gate draft。
- 指标单行：新闸断言 +3 族（freshness/claims/E6-invariants），例外 0
  （γ 未触发），发布包数 4→5。
