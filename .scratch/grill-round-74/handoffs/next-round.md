# Round-74 任务书 — README 打磨（T0–T3）

Stack：本任务书落 `r74-grill` 分支（GitButler）；实施沿用每轮一栈惯例（main 已净 `e184c691`，自 main 起栈）。数据源唯一：`.scratch/grill-round-74/decision-ledger.md`（D-001~D-006）。

## 前置语境（接手者必读实物）

- 主骨架 skill：`readme-crafter-skill-main/SKILL.md`（六阶段+证据阶梯+11 项质检+hard-compare matrix；references/ 下 style-guide/repo-integrity/quality-checklist/worked-examples 按需读）
- 视觉 skill：`beautify-github-readme/SKILL.md`（纯 SVG 道；references/visual-direction.md + project-native-hero.md + github-readme-canvas.md + svg-production.md 动手前必读；scripts/audit_readme.py 为 T3 审计器）
- logo 纪律：`repo-logo/SKILL.md` 仅取 Phase 2/3 概念纪律（视觉解剖/16px 测试/反糖精黑名单）——位图管线不执行
- 双语判官：`scripts/ship-gate.mjs` step 1h（heading skeleton 1:1 / fenced code 逐字对 / link multiset 对（互指 switcher 豁免）/ limitations 指针）——每条改动 EN+zh 同票同 commit
- 现役 README：`README.md`（179 行 canonical EN）+ `README.zh-CN.md`（174 行派生）；四篇宿主专文已有 `docs/{codebuddy,claude,codex,deepseek-harness}-integration.md`；`docs/per-platform-verification.md` 存在——agy 证据归置前先读它对齐
- R73 审计交接：`.scratch/grill-round-73/handoffs/round-73-audit-handoff.md`（含 `origin/r71-grill` 删除候选=收口列报项）

---

## T0 — 诊断+改版计划（覆盖 D-001、D-005、D-006-i）

crafter Phase 1–4 落成实物 `.scratch/grill-round-74/plan.md`：
1. SCAN 补全：`.env.example`/examples/包元数据/既有资产盘点（当前已知：零视觉资产、3 badge、179/174 行双件）。
2. 11 项质检清单逐条诊断现役 README（3-Second/Copy-Paste/Solo/Scan/Accuracy/Public-Surface/Config-Parity/Distribution-Posture/Freshness/Link-Asset/Evidence-Integrity）。
3. **section plan**：现有 12 节逐节判定（保留/合并/新增/删除/移动）+新读序（hero→proof→quickstart→…）+新增节判定（How-it-works Mermaid 位置）。
4. **资产职责清单**：logo/hero/Mermaid/输出块各写「承担的沟通任务」（beautify：每资产须有 job）。
5. 呈报用户过目——**plan 确认后 T1 才开工**（crafter plan-acknowledgment 纪律=D-005 内嵌确认闸）。

验收锚：plan.md 实物+用户确认记录。

## T1 — 视觉资产（覆盖 D-002、D-003、D-005、D-006-ii）

1. **logo 概念提案**（repo-logo Phase 3 纪律）：2–3 个文字概念，各含 Style/Composition/Colors/Rationale/16px 论证/**视觉解剖 ASCII+图元-模块对照表**；呈报用户选定（确认闸 2）→手写 `assets/readme/logo.svg`（self-contained、无外链、文字转 path 原则、深浅底双验）。
2. **hero.svg** 域门构图（D-003）：1200 viewBox、左=字标+一句话价值+logo mark、右=域门示意（扇出→urlAllowlist 闸门→门内干净结果+门外 abstain 卡）；写前读 beautify `visual-direction.md`+`project-native-hero.md`+`github-readme-canvas.md`+`svg-production.md`。
3. 核验：900px GitHub 宽渲染检查+360px 窄屏+深/浅底+16px 缩略可辨+**禁** `foreignObject`/脚本/远程字体/GitHub 剥离 CSS；资产落 `assets/readme/`。

验收锚：两 SVG 实物+选定记录+核验记录（哪项怎么验的）。

## T2 — 内容 surgical（覆盖 D-001、D-003、D-004、D-005、D-006-iii）

顺序硬约束：**`docs/antigravity-integration.md` 新建+agy 证据迁入先于表格瘦身提交**（证据迁移前置——D-004）。
1. EN 先改 `README.md`：hero/logo 嵌入（`width="100%"`+语义 alt）+proof 输出块上移（status 段后，真实摘录非假想）+Mermaid 架构图+verified-hosts 表瘦身（列=Host/Version/Verified scope 短语/Status verdict+专文指针）+节精修按 T0 plan。
2. zh 派生同步 `README.zh-CN.md`：parity 四腿全过（heading 同构/代码块逐字/link multiset/limitations 指针）。
3. agy 专文：与四篇既有专文同构（读 `docs/deepseek-harness-integration.md` 取结构模板）；证据源=`.scratch/grill-round-68/evidence/`+表内现文；`per-platform-verification.md` 若已承载则指针对齐不重复。
4. 零声明漂移：新增文案每句有证据源（证据阶梯）。

验收锚：双件 diff+parity 腿绿+agy 专文入库+瘦身前后对照。

## T3 — 验证+收口（覆盖 D-005、D-006 全量）

1. 审计：`python3 <skill>/scripts/audit_readme.py README.md`（无 python3 则按其检查项手动等价逐条记录）。
2. crafter `repo-integrity.md` hard-compare matrix 过检+渲染预览（本地 Markdown 渲染器或 GitHub 预览）。
3. `node scripts/ship-gate.mjs --quick` 全绿（parity+pathlint 双腿含本票文档）。
4. 文书：ADR-0075（视觉层决策/表格瘦身教义/logo 纯 SVG 由来/imagegen 缺席的降级路径）+CONTEXT 词块（R74 六条已就位，实施期新词补录）+CHANGELOG+found/fixed/deferred+handoff（**列报 `origin/r71-grill` 删除候选**+续债承接原名不动）+pathlint 扫面登记 `grill-round-74`。
5. `but commit` 工作区干净；栈随收口落 main。

## Suggested skills

- `readme-crafter-skill`（T0/T2 主流程——references/ 按阶段读）
- `beautify-github-readme`（T1 视觉层——四篇 references 必读）
- `repo-logo`（T1 概念纪律段）
- `$implement` + `$code-review`（T2 内容改动复审）
- `gitbutler` skill（一切栈操作先读它）
- `$handoff`（收口沿用 Stack but-id+SHA+绿 run URL 模板）

## 红线

- 不动 README 已验证文案的证据性声明（verified-hosts 6 行事实、fail-open 契约、abstain 语义）。
- 不产位图资产、不加 GIF（未 opt-in）、不挂外链图片（self-contained）。
- zh-CN 永不滞后于 EN 提交（Lockstep Edit）。
- 不顺手发 dsh-plugin/不动续债名/不删 `origin/r71-grill`（只列报）。
- README 内路径引用遵 ADR-0072（库内相对路径；scratch 证据不直引——走专文指针）。

## Deferred 承接清单（不改名）

`defer-r73-dsh-event-rename`（0.1.6-rc.1 触发）· `defer-r72-dsh-plugin-npm-publish` · `defer-r72-dsh-native-tools` · `defer-r72-dsh-web-interactive-matrix` · `defer-r71-shipgate-1g-coverage` · `defer-r71-transformers-undeclared-dep` · `defer-r71-provider-serverside` · **新增**：`defer-r74-logo-bitmap-matrix`（imagegen 可用轮产位图全矩阵）。
