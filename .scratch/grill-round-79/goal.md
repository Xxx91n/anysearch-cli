# Grill Round 79 — Goal（定稿态）

Date: 2026-09-23 · 账本 `decision-ledger.md`（D-001~D-004 全 current，唯一权威数据源）· 调研存档 `q1-atomcode.md`/`q2-atomcode.md`/`q4-atomcode.md`（+对应 qN-prompt.txt）

## 主题

**「pathlint 豁免域契约收敛」轮**（治理工具链校准谱系续章）——清算 R78 审计残账中同判定器域三件：F-3（in-repo 判定在 covered-fence/Stack: 行不生效的教义张力）+F-4（fence/locator 内 `/x` info 噪音）合并为单个「豁免域契约」Codify 立法裁决（drift 归因在文本侧）；WORD_CHAR 缺 `_` 边缘 FP 同域工程修正；ride-along T0=dsh 0.1.7-alpha.2 L0/L1 哨戒取证（cadence 到期义务）。

## 显式范围外（负向需求固化）

- **E6 证伪后果**（lockfile 携闸内版 frozen/fetch 静默放行）→显式立项 R80 候选「发布龄期闸 lockfile 执法轮」：先实测 pnpm trustLockfile 验证腿在钉版 11.24.0 覆盖度（与本仓 E6 实证张力待裁），再定自建护栏/引用上游/显式记档。本轮记档不启动——依赖管理域+护栏设计决策类型与本论题不同，混入=杂物筐（atomcode Q1 结论 1/4）。
- 11 条 open 债原名续记（carried_log r79）：defer-anysearch-domain-ownership / defer-f16-macos-native-crash / defer-f17-quarantine-ids / defer-r71-transformers-undeclared-dep / defer-r71-provider-serverside / defer-r72-dsh-plugin-npm-publish / defer-r72-dsh-native-tools / defer-r72-dsh-web-interactive-matrix / defer-r73-dsh-event-rename / defer-r74-logo-bitmap-matrix / defer-r75-registerhooks-esm-arm。
- `#1764` 观察哨续挂（OPEN、2026-09-03 起无更新趋僵）；外发闸两份 draft（`.scratch/grill-round-75/drafts/`）仍用户亲手发；L2 触发器本批无合格候选（rc.3 特征锚缺席+alpha.* 稳定锚不属）不响非抢跑。
- grill 期间不动源码；本轮不设其他目标；信任调研文档级断言止于「留 R80 实测」（trustLockfile 语义与本仓 E6 实证张力未决）。

## 路径纪律自证（ADR-0072+R79 豁免域）

本文件内仓内目标引用全部 repo-relative；无 fence 内路径；无未标记仓外绝对路径。

## 遗留呈报项

- `_scan-fence.cjs`=Q2 前存量扫描取证脚本（fence 内 in-repo 实例=0/locator 行≥1 实证来源），留档备查。
- 上轮教训续记：写文件一律 heredoc/ctx_execute fs 落盘，禁 `node -e` 双引号串（`$`/反斜杠被 shell 层吃掉的前科）；ctx_execute javascript 沙箱对含复杂 require 的 CJS 代码偶发 Bun wrapper 报错→退 shell+`node file.cjs`。
