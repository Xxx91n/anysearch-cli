# R89 Goal — dsh 上游线轮（dsh-upstream-line）

> Slug: grill-round-89 | 定稿 2026-09-29 | 账本：decision-ledger.md（D-001~D-003 全 current）

## 主题

R89 = dsh 上游线轮：上游 0.2.0-rc.1 首目击（2026-09-28T12:14Z，dist-tag next）触发的信号型轮——正题=0.2.0 线 breaking-surface 调研+repin 时机裁决（交付物=L1 探针 transcript+迁移面 diff+时机判词），同域纳编 r72 两票（defer-r72-dsh-native-tools/defer-r72-dsh-web-interactive-matrix）只定形不实现。

## 票序（D-003 七票序+条件票）

| 票 | 内容 | 覆盖 |
|---|---|---|
| T0 | 哨戒续班（dsh dist-tags L0 再观测）+基线快照（check/test/ship-gate 当前态） | D-003 |
| T1 | L1 探针跑批：npm pack 0.2.0-rc.1 全族 tarball→.d.ts 消费子集 diff vs 0.1.7-rc.1 基线；transcript+snapshot 落 evidence/；产出=兼容锚真值+拉力锚具名 API 扫描+dep-closure 变化 | D-001/D-002 |
| T2 | repin 时机判词：按三锚真值表出判词+收口义务条款+类推标注→upgrade-ledger v3 记档 | D-002 |
| T3 | repin 执行条件票：仅当判词=repin-now 才启（repin+L2 安装彩排+必要迁移+回归；R83 TE1 先例） | D-002/D-003 |
| T4 | r72 两票定形：解法案/落点/依赖解除状态随判词与实装态写明（docs 不实现） | D-001 |
| T5 | 收口件批：ADR-0090+CONTEXT 词块+registry r72 两票状态更新+claims+任务书终态戳+evidence 终归档（单 docs commit） | 全条 |
| T6 | 门禁+审计 LOOP：pnpm -r check/test+ship-gate --quick+惯例复核 | D-003 |

## 关键判据（预注册，先于 L1 探针立法——D-002）

- **兼容锚**：已消费子集零破坏漂移——ctx.on(agent/created) payload {agent,source,signal?}+tools/pre-execute|post-execute|result 三事件+ctx.systemPrompt.section+inject=['tools','systemPrompt'] 在 0.2.0-rc.1 .d.ts 全在且签名同构；未消费键漂移≠兼容破坏。
- **拉力锚（证据枚举化）**：r72 票面具名 API 在 0.2.0-rc.1 .d.ts 出现且签名稳定（工具注册面/web 交互面其一即响）或安全/正确性修复证据；不收泛化「成熟化」。
- **稳定锚**：rc 线在架+2880min 龄期闸+changelog 不可公网核验→tarball diff 自证+缺口记档。
- **真值表（无第三态）**：拉力∧兼容→repin-now；兼容∧零拉力→soak-until-stable（默认兜底，必产出决定）；兼容破坏→hold。
- **收口义务**：repin-now 后 0.2.0 stable 晋升时只再验一次收口探针即封账，不跟随 rc.N 滚动。
- rc→rc 跨 minor 平移如实标注为类推非先例。

## 显式范围外

评测面（f17 等，无新触发）/垂域方向重议（具名重开条件未达）/上游触发债（r81/r84/r86×2）/常驻债×5/0.1.0 钉版动包/任何外发动作（无 tag/publish）/R88 残余观察项（ANS_PROBE_QUERY 不对称、libuv 噪声）就地扩票/r72 实现（定形不实现；提前实现须过 L2 闸）。

## 遗留呈报项

T3 条件票启停结果、repin 判词本身、探针意外发现（新债三向分流）、熔断/缩轮事件——均回呈用户裁决。
