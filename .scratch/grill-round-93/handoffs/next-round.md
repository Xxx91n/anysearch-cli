# R93 常驻任务书 — L3 修复续轮【换模三跑】+ 售后收口

编制: 2026-09-30 | 账本: .scratch/grill-round-93/decision-ledger.md（D-001~D-003 全 current）| 调研: q1/q2/q3-atomcode.md | 目标: .scratch/grill-round-93/goal.md

## 开工三件套

1. 读本文件 + decision-ledger.md + goal.md（账本为唯一事实源，对话回忆不作数）。
2. 建 GitButler 工作分支（建议 `r93-l3-rerun`，与其他 lane 并行不互扰）。
3. T0 起步——哨戒+基线先行，TC 窗口一次定死。

## 已实证事实底账（勿重跑）

- `moonshotai/Kimi-K2-Instruct-0905` 在 featherless 直连 → 200 + `finish_reason: tool_calls` + 正确函数载荷（2026-09-30 裸探针）。
- `moonshotai/Kimi-K2-Instruct`（非 0905）直连 200 应答（tool_calls 未专测——换臂前必跑 preflight 验）。
- `Qwen/Qwen3-32B` = reasoning 形态（finish_reason=length 只产 reasoning 字段 45s+）——R92 F-bug 签名复现，非瞬态。
- featherless 配额：`feather_pro_plus` 计划并发上限 4 units；Kimi-K2 实测 4 units/req——一切请求严格串行。
- 托管目录：`Kimi-K2-Instruct-0905` Context Size=32k（非原生 256K）；`/v1/models` 枚举端点 404 Gone（厂商侧缺席）。
- `DEEPSEEK_API_KEY` 在 User-scope 存在（len=67），对 featherless 有效——子进程注入，值不落盘不落上下文。
- `r92-smoke` profile 实物在机外 dsh home（`~/.dsh/profiles/r92-smoke/`），patch 两处硬编 `Qwen/Qwen3-32B`——R92 证据工件，冻结零触碰。<!-- machine-local: 用户级 dsh profile 目录为机外路径 @ 2026-09-30 -->
- 本仓 npm：cli/dsh-plugin latest=0.1.0；dsh 宿主 dist-tags=latest 0.2.0-rc.2/next 0.2.0-rc.2（无 stable）；deprecate 双空格仍在（`Fixed in 0.1.0␣␣upgrade.`）。
- README.md:227 / README.zh-CN.md:217 dsh 行仍 `0.1.5-rc.2 | MCP bridge patch`（落后三代）。

## 票序（逐票声明 D-xxx 覆盖）

| 票 | 内容 | 覆盖 | commit 类型 |
|---|---|---|---|
| T0 哨戒+基线 | dsh dist-tags 复观（0.2.0 stable 目击→TC 定死，未目击 TC 不启不留痕）；check/test/ship-gate --quick 基线快照；grill 期五件探针归档为 evidence | D-001/D-003 | chore+evidence |
| T1 立法 | 新 ADR-0094：D-002 执行设计全包（profile 参数/B1 链/诱导句/32768/签名族三形态/max-tokens 预算钉/L3c=ans_* 收窄/≥2 换臂复盘闸/ID 污染 Known-Non-Goals）+T-B 双态记账票立法（白名单+链尽谓词+三条件票互斥谓词）+README 措辞承继（ADR-0093 双版誊抄+四列表格形态调和）+r88 sunset 条款（R95 硬顶+R94 预通知+owner 点名）+deprecate 三型枚举（含每型 fallback 字段）+证据效力口径节（d7 保守默认 advisory+下轮复核登记） | D-001/D-002/D-003 | docs |
| T2 执行 | 串行 preflight（0905 tool_calls 复验+32768 超长探针+units/plan 核查）→建 `r93-kimi`→plugin add 冷启（L3a）→dump-config→诱导 turns（冻结句，N≤3 串行）→transcript/verdict 双工件→泄漏探针（SHA-256 前缀 grep）→判词。链尽→F-bug+T-B 启 | D-001/D-002 | evidence |
| T-B【条件转向】 | 链尽判词显式成立才触发（429/环境违规不触发）：F-bug 登记（defer 条目）+轮内开 r88-candidate 开庭议程（引预注册条款，禁现场拟） | D-001/D-003 | docs |
| T3【条件】 | README 双语行对齐：T2 判词达标（established 或 established-via-fallback 档）且 T-B 未启→按 ADR-0093 承继措辞誊抄，禁现场拟 | D-001/D-003 | docs |
| T4【条件】 | readme-token-pin 机器腿首跑：README 改→真跑取证；未改→shadow-run+挂账 R94（两态产出预注册，票永不空） | D-001/D-003 | evidence |
| T5 deprecate | 权限到位→执行 6 版本枚举重发（备准命令在 .scratch/grill-round-92/evidence/t5-deprecate.md §2）；未到位→纯备准核销+三型枚举填值 | D-001/D-002 | chore |
| T6 收口批 | 内部多 commit 分节（每节独立可 revert）：①ADR-0094 完成体②CONTEXT 词块+registry 更态（defer-r92 两项核销/转挂+r88 sunset 落账）③closeout-claims+轮报+终态戳④CHANGELOG⑤锚定纪律修复（ADR-0092 L162+R91 三文书「sha 已对齐」→「落笔时值」）⑥常驻债词汇归一 | D-001/D-003 | docs |
| T7 门禁+审计 | check/test/ship-gate 全链+审计 LOOP（≤2）；判词词汇从 t2-verdict 一字不差取 | D-001/D-003 | — |
| TC【条件】 | T0 目击 dsh 0.2.0 stable→closing probe；未目击不启不留痕 | D-001 | — |

## 跨票闸（硬约束）

1. **一票一 commit 类型不混**；票级熔断 2-LOOP；pathlint 冻结；无 tag/push/publish。
2. **T1 立法先于 T2 行为**；条件票（T3/T4/T-B）不带立法不现场拟措辞。
3. **T-B 触发谓词=链尽判词显式成立**（非「T2 未绿」）；429/环境违规一律不计入 N 不触发 T-B。
4. **换臂纪律**：换臂前先 preflight 验 Instruct tool_calls；换臂写 transcript（which model+why）；≥2 换臂即使终绿触发 F-bug 复盘闸。
5. **L3c 判词收窄=「ans_* tool_call」**——非 ans_* 的 tool_call（含幻觉调用）不计绿。
6. **签名族计 N 边界**：length 形态计 N 前先钉 max-tokens 预算判据（区分预算小 vs 模型不行）。
7. **凭证卫生**：User-scope 读 DEEPSEEK_API_KEY→子进程注入；值不落盘不落上下文不落 transcript；收尾泄漏探针=SHA-256 前缀 grep。
8. **锚定纪律**：but-id 为唯一稳定锚；文内 sha 均「落笔时值」口径（禁「sha 已对齐」病句）；land 后以 main git log 为准。
9. **d7 口径**：本机门禁证据=advisory 非 blocking（保守默认）；用户拍板则以其裁定为准。

## 显式范围外

repin / 垂域死刑复核主体（例外=sunset 条款写入+T-B 触发的开庭议程）/ web-matrix 主体（defer-r72-dsh-web-interactive-matrix 维持 defer）/ 评测面（defer-f17 等）/ 常驻债清理 / approval-channel / tag·push·publish / pathlint 解冻。reason: 各项在 registry 候审，本轮主轴为 L3 修复续轮。

## 汇报纪律

- 判词词汇从 `.scratch/grill-round-93/evidence/t2-verdict.*` 一字不差引用（established / established-via-fallback / not-established / F-bug）。
- 零改动结果记为 rejected evidence/reasoning，不静默当成功。
- 每票完成呈报：commit but-id + 实证索引 + 判词/产物态。
- deprecate 外发动作先 EOTP 呈报，用户亲触后才执行。

## Suggested skills

- `gitbutler`（but）：全量版本控制；but-id 锚定纪律见上。
- `implement` / `diagnosing-bugs`：T2 执行与上游异常归因。
- `domain-modeling`：T6 CONTEXT 词块落笔时的术语一致性。
- `handoff`：轮末交接件再生成本件同构。
- `atomcode-research`：中断性调研（备用模型源/垂域开庭议程起草若 T-B 启）。
- `code-review`：轮末双轴复核。

## 终态戳位

收口完成后在本文件尾追加：「R93 终态 — 判词:___ | 票序完成:___ | 挂账移交:___」
