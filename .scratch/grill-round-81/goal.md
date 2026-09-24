# Grill Round 81 — Goal（定稿态）

## 主题

「产品吸气轮」（D-001）：凝聚轴=deferred-registry 在册产品形债吸气；唯一主轴=`defer-r71-provider-serverside` spike——诊断 R71 时 provider 检索端点 live search 返 HTTP 000 的 server 侧病因（D-002 三分支谱系：复活去种子化/死但可修/死且外部不可控→降级宣称或换 provider）；发布执行=触发即插插曲协议非轮腿（D-001+D-004）。

票序（D-003 五段式+TI 就绪件）：T0 哨戒续班→TI 插曲就绪（R1 幂等跳过补丁，release.yml 唯一改动）→T1a 网络/设施侦察 ∥ T1b 宣称审计→T2 判别实验矩阵→T3 诊断书→T4 文书收口；timebox 2.5d 等效（.25/.75/1/.5），超时降级收口。

收口判据（D-005 三段+两补项）：取证段/就绪段/文书段+「决策-推荐分离」判据行（ADR-0082 持 Decision、诊断书只产 Recommendation）+降级时未测假设带 H#+Test 字段随具名票转移。

## 显式范围外（负向需求固化）

- 修复码（端点修复/去种子化实施）——Lacey 规则归 R82 立项（D-002）；
- 并行腿（dsh-web-interactive-matrix 等）——单一主轴不破（D-001/D-002）；
- 用户三扳机（手发 dsh-plugin@0.0.7/TP 四字段配置/推 v0.0.8 tag）——外部前提代理不代扣（D-001/D-004）；
- unpublish-first——官方 strongly recommend deprecate+投毒锁死先例（D-004）；
- staged publishing——npm 11.15+ 且不支持新包首发（D-005）；
- 模拟 registry/`npm publish --dry-run` 充当 R1 验证——官方实测不构成认证/版本校验（D-005）；
- 其余 open 债（dsh-native-tools 触发器并入哨戒续挂/event-rename/registerhooks/logo/f16/f17/domain-ownership 等）——续记 registry（D-002）。

## 数据源纪律

整理期唯一数据源=decision-ledger.md；对话回忆不入账，结论确认即落账。本文件已由账本回写定稿。

## 上下文锚

- 账本 `.scratch/grill-round-81/decision-ledger.md`（D-001~D-005 全 current，无断号无 revised）；
- 任务书 `.scratch/grill-round-81/handoffs/next-round.md`；
- 调研存档 `q2-atomcode.md`~`q5-atomcode.md` + 各 `qN-prompt.txt`；
- R80 交接件 `.scratch/grill-round-80/handoffs/`（closeout+audit-signoff，审计 PASS）；
- 锐评原文 `.codex-tmp/锐评.txt`（r7，2026-09-23）；
- 开放债：`docs/deferred-registry.json`。

## 路径纪律自证（ADR-0072+R79 豁免域）

本文件内仓内目标引用全部 repo-relative；无 fence 内路径；无未标记仓外绝对路径。

## 遗留呈报项

- 用户三扳机未扣前发布面不动作；插曲触发按 D-004 规程执行+每事件 transcript 落 `evidence/release-interlude-<n>.md`；收口时未触发如实记「未触发」；
- spike 实测与账本冲突→对应 D-xxx 标 revised+新 D 呈报用户，禁静默改向；
- R1 补丁=本轮唯一 release.yml 改动，属插曲就绪件非 spike 修复码（D-004 §1 边界已立法）。
