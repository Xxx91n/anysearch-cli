# ADR-0095: Grill Round 94 — r88-candidate 垂域死刑复核开庭轮（议程五段 + B3 混合判词归属 + 三果谓词可控性边界 + tie-breaker 预注册 + 快照/活查分级 + cn_code 具名步骤 + stream-json 版本指纹 + 判词词汇冻结 + D6 分级落地 + 开庭即预通知 + Known-Non-Goals + dsh 漂移条款 + carried_log 必备字段集）

## Status

Accepted (grill round r94; 主轴票 r88-candidate-vertical-direction-court-session). Records T0–T7 per task book `.scratch/grill-round-94/handoffs/next-round.md`. Ledger: `.scratch/grill-round-94/decision-ledger.md` (D-001~D-003, all `current`). Evidence root: `.scratch/grill-round-94/evidence/`.

## Context

registry 候审项 `r88-candidate-vertical-direction-redeliberation`（垂域方向重议候审）自 R88 设立起已持续候审 5 轮（R88→R93）。ADR-0094 D4 正式确立了 sunset 硬截止条款（R95 前强制开庭 + R94 预通知义务）。
本轮（R94，D-001）主轴为提前一轮开庭兑现 sunset 条款（review period 先于 expiration 的规范结构），终结「维持 defer」作为无期限默认态导致的无限期滞留。

为保障开庭审理的法理严密性与防自动化偏倚，必须遵循 Nature Registered Reports 两阶段审查模型：
在取证和求值前，全面冻结开庭议程、判词词汇、三果充分条件谓词、tie-breaker 仲裁规则、复活条件集可控性分类及 D6 副议题分级方案。

T0 哨戒与基线已由 commit `nmz` 归档在案：
- dsh dist-tags 为 `{alpha: "0.1.7-alpha.2", latest: "0.2.0-rc.2", next: "0.2.0-rc.2"}`，**无 stable 晋升**，TC 谓词未触发（未目击 TC 不启不留痕）。
- 开庭资格核验正常，T0-F 复议轮降级程序票不触发。
- 基线 check 8/8 全绿（68ms FULL TURBO），test 13/13 全绿（4m3s）；全量 ship-gate 预检永久不变量与静态断言全部 pass，唯一阻断为在途新鲜度腿（CHANGELOG r94 缺位，属 T6④ 排期交付项），基础环境完全洁净。
- carried_log 预通知指针条目已由先行 commit `kvs` 落盘于 `docs/deferred-registry.json`，自证时序角色发生于本立法 commit 之前。

## Decision

### D1 — 议程五段式结构与程序出口

开庭审理严格分为五段依次推进：
1. **段 0：开庭资格核验**：核验 sunset 四要素（deadline R95 前、owner `anysearch-eval` 具名、carried_log 预通知在位、三果谓词预注册）。若核验失败转触发式程序票 T0-F（全轮降级复议轮，产复议 ADR 与 R95 议程建议，对应 Terminated Registration 机制）。
2. **段 1：证据面陈述**：汇总维持 defer/revise 侧 vs retire 侧双侧证词登记表。
3. **段 2：判据合法性先审**：先裁尺子后裁方向。确认 L3b primary 取证腿结构性不可观测；revise 判据不等同于 revise 方向，拆开审理；审议重开尺 `|ΔarmHostHit|≳0.4` 的合法性与等价性论证。
4. **段 3：判词表决**：按 B3 混合制求值充分条件谓词。
5. **段 4：落地裁定**：按最终判词更新 registry 状态，强制附具名复活条款。

### D2 — B3 混合判词归属与 exploratory 区机制

判词归属采用 B3 混合制（Nature Registered Reports 工程直译）：
- **谓词命中**：三果充分条件谓词若命中任一分支，直接机械落果产出判词文档，不引入主观裁量。
- **未命中（exploratory 区）**：若三果充分条件谓词均未命中，整套证据登记表全文与推荐果进入 exploratory 区，在收口窗提交用户拍板，单独标注不作为主结论。
- **拍板不可达出口**：若用户在收口窗不可达，未命中条目挂账 `pending-user-verdict`，三果均不落，registry 维持待审状态，列为 R95 第一待办项。绝不允许凭空发明第四种判词态充数。

### D3 — 三果谓词加固与复活条件集可控性分类

R86 实测为负新事实下，「维持 defer」与「方向撤销」的证据基础已融合，其根本分水岭在于**复活条件的可控性**：

1. **reaffirm（重申维持）**：
   - 充分条件谓词：`|ΔarmHostHit|≳0.4` 实测为负 $\land$ 标的实存（垂域三 ADR 在案存续）$\land$ 存在 $\ge 1$ 可控复活条件。
   - 语义：方向假设在射程内，当前尺量为负且未来具备反转检验能力；原判据废止并留存理由。
2. **revise（修订重开）**：
   - 充分条件谓词：判据不等价/欠上游契约可测面 $\land$ 存在可归因且近程的修复路径（具名 owner + 可检验完成态）$\land$ 活查具备实质变化迹象（无变化则视为无意义空转）。
3. **retire（废止退役）**：
   - 充分条件谓词：标的实存性弱（垂域三 ADR 论证面塌陷或被正式 supersede）$\lor$ 复活条件仅剩不可控外部信号。
   - 语义：desuetude 工程直译（长久未用且无内生杠杆复活）；明文正式废止优于隐性长期滞留。

**tie-breaker 仲裁规则（开庭前冻结）**：
- 可控锚 $\ge 1 \rightarrow$ **reaffirm 优先**；
- 可控锚 $= 0 \rightarrow$ **retire 优先**。
开庭过程中临时采纳任何替代规则均视为严重违规。

**复活条件集收编与可控性分类**（每条必须挂 owner 或可机检信号，无则裁撤）：
- ① `dsh stable 晋升`：半可控，可机检（npm registry tags），保留。
- ② `上游补垂域参数词表`：纯外部信号，归入 retire 侧（单独不足立案，须叠加 ④/⑤）。
- ③ `cn_code 契约补齐`：半可控，有 owner，作为 revise 主锚。
- ④ `新评测矩阵修订版读数`：唯一纯可控内部锚，作为 reaffirm 主锚。
- ⑤ `|ΔarmHostHit| 显著转正`：并入 ④（手段 vs 读数防重复计数）。
- ⑥ `判据等价性证明`（可选）：纯内部锚，构成 reaffirm $\rightarrow$ revise 转换桥梁。因段 3 充分条件已由 ①~④ 满足，条件 ⑥ 作为内部技术验证路径保留，未列入 registry 落地之必要立案条件。

**锚计数纪律**：锚计数必须在 T3a 证据登记表落盘时刻预标注并冻结，段 3 只求值、不计数。具有具名 owner 之可控锚为 2 个（条件 ③ 与 条件 ④，owner 均为 anysearch-eval）；广义含外部可机检条件 ① 为 3 个，两者均严格满足 $\ge 1$ 充分条件门槛。

### D4 — 快照/活查分级纪律与具名步骤

规则成文化为「**判据/读数用快照，契约/环境现状用活查**」：
- **快照项**：历史评测序列（R85 indeterminate 装置缺陷、R86 direction-negative 净 -0.125）严格采用已定稿历史快照，遵循单次终读纪律，绝不重跑 delta 或 headless turn。
- **活查项**：`cn_code` 契约状态与参数支持现状采用只读活查，作为开庭议程段 1 内的**具名步骤**严格登记，严禁在判词段临时起意插拔。
- **stream-json 结构证据**：以本机 dsh 全局安装包只读勘查为主、GitHub 源码为辅，版本指纹严格绑定 `0.1.7-rc.2`（明确声明对当前版本有效，若后续 stable 晋升字段面可能发生变动，直接服务于复活条件①）。

### D5 — 开庭即预通知与 carried_log 双动作时序

裁定以「开庭即预通知」双动作替代 ADR-0094 D4 对 R94 收口批 carried_log 的单一解释：
1. **先行 commit**：在开庭立法前，于 `docs/deferred-registry.json` 追加一条 carried_log 预通知指针（commit but-id `kvs`），commit message 自证时序角色（预通知点先于立法、具名 owner `anysearch-eval`、触发 ADR-0094 D4）；
2. **随后 commit**：本 ADR-0095 立法 commit 随后固化。
两动作同轮闭环，从根本上防止审计中间态断裂。
同时明确 carried_log 必备字段集标准：`id`（条目）、`owner`（具名责任方）、`trigger_rule`（触发规则）、`at`（时间戳）。

### D6 — D6 副议题分级落地裁定

依据风险分层原则（Texas sunset 分类心智模型），副议题裁定为分级落地：
1. **ship-gate 效力复核确认**：复核确证 `scripts/ship-gate.mjs` 在基线已具 blocking 退出语义（失败时 `process.exit(1)`），本轮无源码改动，裁定确认其合入门禁地位，不可 advisory 化。
2. **check + test 维持 advisory**：作为开发反馈环，避免将瞬态 flaky 噪声转化为硬阻塞。留存上升通道。
3. **生效时点与谓词反转偏差自报**：以 T0 全量 ship-gate 预检为谓词源。T0 实测确认 check 8/8、test 13/13 全绿，但全量 `ship-gate.mjs` 因 CHANGELOG 缺 r94 条目返回 exit 1（在途中态）。开庭程序中将其定性为排期在途的分节依赖假红，未按 spec 原文「红→降级复议票」执行，构成庭中重解释之未申报偏差。审计打回后本轮正式记入风险账本如实申报。

### D7 — dsh 版本轴漂移条款与 Known-Non-Goals

1. **dsh 漂移条款**：宿主环境目前仍为预发布态（latest=0.2.0-rc.2，无 stable），此未定型状态作为外部客观环境辩护词计入开庭证据。
2. **显式范围外（Known-Non-Goals）**：遵循 ADR-0029 单轮单主题纪律，以下事项严格排除在本轮之外：
   - repin / 垂域语料修复票主体（r86 两项仅作证据吸收）
   - web-matrix 主体
   - 评测面主体（不重跑 delta）
   - 常驻债清理主体
   - approval-channel 交互实施
   - deprecate 外发（EOTP 用户亲触，严禁代跑或借凭证绕闸）
   - tag / push / publish
   - pathlint 规则解冻

### D8 — claims 冻结纪律与 Stage 2 审计规则

为根绝 R93-F1 同型审计打回缺陷，确立 claims 冻结硬纪律：
1. **最后增改点**：T6③ 轮报与 closeout-claims.json 提交为本轮最后一个允许增改 claims 的 commit。
2. **冻结声明**：T6⑤ 在收口交接件中输出「claims 冻结声明」（明示条目计数及各项状态），供 T7 机械比对。
3. **T7 只读复证**：T7 仅执行只读复证；若门禁红进入审计 LOOP，修复 commit 严禁修改 claims 实物，任何发现的偏差必须以「申报偏差」如实记入 R95 交接文档。Stage 2 接受与否取决于是否忠实执行预注册协议，未申报的偏差才构成否决。

### D9 — 判词词汇与落地态名称预注册冻结

开庭全程严格使用预注册词汇，严禁临时发明：
- **判词词汇**：仅限 `reaffirm`、`revise`、`retire`，以及未命中时的出口态 `pending-user-verdict`。
- **落地形态预注册**：
  - 若为 **reaffirm**：registry 状态变更为 `formally-declined`，附具名复活条件，原判据废止留理由；
  - 若为 **revise**：改写重开条件判据，设定新观察窗（如 R96~R99）；
  - 若为 **retire**：registry 状态变更为 `retired`，明文废止并保留复活条款。

## Consequences

- 终结 r88-candidate 候审项长期以来的无限期候审态，使 sunset 机制具有可执行的程序闭环。
- 确立「快照/活查分级」与「开庭即预通知」双动作规范，为后续类似候审标的提供标准化立法先例。
- ship-gate 阻断权威性经复核确认：基线已具 blocking 退出语义（失败即硬阻断），本轮无源码改动；本轮 T7 已按该效力口径接受合入门禁检验。

## Execution Record & Verdict Completion

### 1. 终审判词与落果结果
- **开庭审理判词**：`reaffirm`（充分条件谓词全命中，机械落果）
- **registry 落地态**：`formally-declined`
- **原裁判尺状态**：`|ΔarmHostHit|≳0.4` 废止（留存历史原由说明）
- **具名复活条件集**：
  1. 条件 ①：dsh stable 晋升（半可控，npm registry tags 机检）
  2. 条件 ②：上游补垂域参数词表（纯外部不可控）
  3. 条件 ③：cn_code 契约补齐（半可控，owner: anysearch-eval）
  4. 条件 ④：新评测矩阵修订版读数（纯内部纯可控，owner: anysearch-eval）

### 2. 票序与 commit 双锚表（落笔时值）

| 票 | but-id | git sha (真实值) | 类型 | 结果 | 产物与实证索引 |
|---|---|---|---|---|---|
| **T0 哨戒+基线** | `nmz` | `53e9dc76` | chore | ✅ PASS | `evidence/t0/t0-baseline.md` + check/test/ship-gate 三腿日志 |
| **T0-F 触发式程序票** | — | — | docs | ⏭ 未触发 | 开庭资格核验成立（TC 未触发，标的未变），全轮正常推进开庭 |
| **T1-1 carried_log 先行** | `kvs` | `bcde2ba9` | docs | ✅ PASS | `docs/deferred-registry.json` 预通知指针条目落盘 |
| **T1-2 ADR-0095 立法** | `zwl` | `317fe6e8` | docs | ✅ PASS | `docs/adr/0095-*.md` + `docs/adr/index.md` 开庭立法本体 |
| **T2 开庭取证** | `zss` | `6d8a0102` | evidence | ✅ PASS | `evidence/t2/` 卷宗 01–05 + 双侧证词登记表初稿 |
| **T3a 登记表落盘** | `mzp` | `dc6d5d48` | evidence | ✅ PASS | `evidence/t3a/evidence-register-table.md`（锚计数预标注冻结） |
| **T3b 判词票** | `vor` | `21fe1ec1` | docs | ✅ PASS | `evidence/t3b/t3b-court-verdict.md` + `verdict.json`（reaffirm 机械落果） |
| **T4 落地裁定** | `lkp` | `056d4e0a` | docs | ✅ PASS | `docs/deferred-registry.json` 状态变更为 formally-declined |
| **T5 deprecate 备准** | `lsm` | `eae2bd2d` | chore | ℹ️ 纯备准 | `evidence/t5-deprecate.md` 纯备准续挂 |
| **T6-1 完成体回填** | `rvx` | `99ad278a` | docs | ✅ PASS | `docs/adr/0095-*.md` 回填判词 reaffirm、双锚表与 carried_log 必备字段核对 |
| **T6-2 词块与状态核对** | — | 并入 `ce62d7a1` 与 T4 | docs | ✅ PASS | 并入 grill 与 T4，非独立 commit；CONTEXT 8 词块入册 + registry 41 条全量状态核对一致（closed:27/open:13/formally-declined:1） |
| **T6-3 claims+轮报+终态戳** | `mmy` | `3004a3c0` | docs | ✅ PASS | `closeout-claims.json`（11 条）+ 轮报 + `next-round.md` 终态戳 |
| **T6-4 CHANGELOG 追加** | `kmm` | `54946c9c` | docs | ✅ PASS | `CHANGELOG.md` 追加 r94 开庭轮记录 |
| **T6-5 R95 交接件** | `ozw` | `57fc4a29` | docs | ✅ PASS | `round-94-closeout.md` 落盘，claims 冻结声明，F3~F5 记账 |
| **T6-5 ADR index 索引同步** | `stm` | `0bde339f` | docs | ✅ PASS | `docs/adr/index.md` 索引同步更新至 95 ADRs at HEAD |
| **T7 门禁+终验审计** | `pul` | `320d9e41` | evidence | ✅ PASS | `evidence/t7/` 门禁与终验日志全量归档 |
| **审计产物归档** | `tql` | `a6e88137` | docs | ✅ PASS | 审计报告与交接件（CONDITIONAL PASS，R1~R5 返修清单） |

*锚定纪律声明：but-id 为本仓跨环境唯一稳定锚，git sha 遵循真实 commit 对象解析值。*

### 3. carried_log 必备字段集机械核对

经对 `docs/deferred-registry.json` 中 `r88-candidate-vertical-direction-redeliberation` 的 carried_log 数组进行机械核对：
- **条目（id）**：`r88-candidate-vertical-direction-redeliberation` 吻合
- **责任主体（owner）**：`anysearch-eval` 吻合
- **触发规则（trigger_rule）**：`ADR-0094 D4` 与 `ADR-0095 D9` 吻合
- **时间戳（at）**：`2026-09-30` 吻合
- **JSON 规范性**：严格通过 `node scripts/governed-json.mjs` 单空格缩进与 LF 校验。
