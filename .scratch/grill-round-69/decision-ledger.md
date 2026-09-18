# R69 Decision Ledger — grill-round-69

> 数据源纪律：本账本是整理环节唯一数据源。每条含 ID/原问题/用户原回答原文/规范化需求/显式约束/状态。

## D-001 — R69 主题定界

- **原问题**: R69 主题定界——门面单主题（T0 修红+README 双语门面+顺手项）/ 加首推线 / 最小轮 / 其他。
- **用户原回答原文**: 「A」
- **规范化需求**: R69=GitHub 仓库门面单主题。T0=main tip ship-gate 红修复（round-69-direction.md vs handoff-lint 裁决）；主线=README 双语门面重构（中英、用户向、整洁，beautify-github-readme+readme-crafter 为工艺基线）；顺手项 L-1（report L43 相对路径）/L-2（verify-observation 时序抖动）/F-S4 残留语义/ship-gate comment 清理入票。
- **显式约束/负向需求**: R68 方向指示三首推线显式 deferred——真 release 摘 partial 帽（烧 OF look）、agy ans-MCP P7 真链腿（需起 ans server）、PR-mode/required-checks 治理（发布流重构）；deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/embedding/cross-OS/plugin/watch）沿用不进轮；grill 中不动源码。
- **状态**: current
- **记录时间**: 2026-09-18

## D-003 — 双语形态

- **原问题**: README 双语形态——EN 主+zh-CN 伴生 / 单文件互排 / CN 主 / EN+CN 摘要块。
- **用户原回答原文**: 「A」
- **规范化需求**: README.md=英文主件（npm 注册表渲染、国际可发现性），README.zh-CN.md=中文伴生件（顶部互链，非二等翻译——AnySearch 垂直领域理念用母语叙述）。
- **显式约束/负向需求**: 不做单文件互排（长度翻倍、锚点复杂）；不 CN 主件倒置 npm 惯例；两文件内容等价同步（同步漂移风险入票验收）。
- **状态**: current
- **记录时间**: 2026-09-18

## D-004 — README 信息架构

- **原问题**: README 信息架构选型——A 重构迁出 / B 全保留重排 / C 极简全砍（atomcode 调研后呈 A′）。
- **用户原回答原文**: 「A′」
- **规范化需求**: README=登录页非工程档案。Known limitations 全文迁 D:\Aworker\anysearch-cli\docs\limitations.md，README 留 top-3 摘要表+链接（ADR-0062 D4 忠实执行）；Architecture decisions 76 行目录删，改 Design rationale 段（垂直领域/abstain-first/fail-open 三句）+docs/adr/ 一行指针，ADR index SSOT 归 docs/adr/；机器本地证据路径清零（改仓库相对路径或删）；verified-hosts 表/badges/Quickstart 保留（Proof 区）；README.md 声明 canonical，zh-CN 标派生。
- **显式约束/负向需求**: docs/limitations.md 纳入 ship-gate 文档同步检查（防迁出遗忘——B 的合理内核以此缓解非塞回）；双语同步验收=heading 结构 1:1+链接/代码块 byte-identical（spec-kit PR #3740 判据）；徽章只放动态可验证（npm version/CI/license），Evidence Integrity 测试。
- **状态**: current
- **记录时间**: 2026-09-18

## D-005 — 门面边界

- **原问题**: 「GitHub 仓库门面」边界——只 README 双件 / +仓库元数据（description/topics）/ +.github 社区基建 / +视觉资产（hero/social preview）。
- **用户原回答原文**: 「A′」
- **规范化需求**: 门面=文件面+设置面：README 双件（D-003/D-004）+ 仓库元数据治理（description 改产品向一句、topics 加垂直领域/agent CLI 类标签）+ docs/adr index 建立（D-004 迁移前置件）+ LICENSE 识别顺手查（Apache-2.0 被 GitHub 判 Other）。不做 .github 社区基建（CONTRIBUTING/issue 模板/FUNDING 出范围）；视觉资产只加徽章（动态可验证），hero banner/social preview 图不产。
- **显式约束/负向需求**: 仓库元数据改动=设置面操作需记录命令进票（gh repo edit 类）；不生成图像资产文件（仓库不引入二进制美术件）；徽章遵守 Evidence Integrity（只指向真实端点）。
- **状态**: current
- **记录时间**: 2026-09-18

## D-006 — T0 修形：方向文档 vs handoff-lint（补 Q2 位）

- **原问题**: T0 修形——A 只修文档 / B 只修 lint / C 双修 / D 改名绕 lint。（编号注：Q2 曾被跳过未问，本题以 Q6 补问；D-002 空号保留作跳号证据。）
- **用户原回答原文**: 「C」
- **规范化需求**: 双修——(i) 文档侧：D:Aworkeranysearch-cli.scratchgrill-round-68handoffsound-69-direction.md 补「绿色 run URL」段+Stack 头+三条三绿 run URL（35302952077/35302952056/35302952093，head_sha=6acc53c 为 HEAD 祖先，liveness 腿可过），其「双 land 远端三绿」主张获得引证；(ii) lint 侧：scripts/ship-gate.mjs isCloseout 收窄至要求 closeout|closure 关键词（^round-d+ 裸前缀不再单独命中），direction/task 类新文档不再被形状腿误伤，round-67-closeout 等真收口件仍命中。
- **显式约束/负向需求**: 不改名绕 lint；不删 lint；收窄后须验证既有收口件仍被 lint（防过度收窄）+方向文档脱靶（形状腿不再命中）；main 复绿需 ci+ship-gate 真实 run URL。
- **状态**: current
- **记录时间**: 2026-09-18

## D-007 — 值守形态（双语同步+迁出文档防漂移）

- **原问题**: 双语 parity（EN heading 1:1+code/link byte-identical）与 docs/limitations.md 迁出防遗忘——standing ship-gate fail-closed check / warn-only / 一次性票内验收 / canonical 声明即止。
- **用户原回答原文**: 「A」
- **规范化需求**: ship-gate 新增 standing fail-closed 检查步（与 step 1b/1g 同族）：(i) README.md 与 README.zh-CN.md heading 结构 1:1+代码块/链接 byte-identical；(ii) docs/limitations.md 存在且 README 指针可达；(iii) gen-adr-index.mjs 重指向 docs/adr/index 目标文件（D-004 迁移的耦合后果，原 README 内嵌 index 段删除后 step 1b 须同步改靶，否则 ship-gate 自红）。
- **显式约束/负向需求**: fail-closed 非 warn——漂移=红=alert-and-block 教义沿用；检查须覆盖'EN-only edit 后任意 push'场景（漂移持续=持续红，非仅当次 diff 命中）；不做 canonical-only 无检方案。
- **状态**: current
- **记录时间**: 2026-09-18

## D-008 — 票序结构

- **原问题**: 票序——A 七票串行 T0-T7 / B T4 并入 T3 / C T1+T2 并票 / D T5 提前。
- **用户原回答原文**: 「A」
- **规范化需求**: T0 火线（D-006 双修+双绿 run URL）→T1 迁移地基（docs/limitations.md 立件+docs/adr/index 生成+gen-adr-index 重指向+step 1b 改靶）→T2 README EN 重构→T3 README.zh-CN.md（canonical/translation 声明+switcher）→T4 值守检查（ship-gate parity+limitations 步）→T5 元数据+顺手（gh repo edit+LICENSE 查+L-1/L-2/F-S4/comment）→T6 文书（ADR-0070+CONTEXT+CHANGELOG+三元组）→T7 收口。
- **显式约束/负向需求**: 地基先于门面（README 链接必须指向已存在文件）；canonical 先于翻译；门禁随内容落地后置；一票一验串行惯例沿用。
- **状态**: current
- **记录时间**: 2026-09-18

## D-009 — 收口判据

- **原问题**: R69 收口判据形态——A 四段收口（修红/门面/值守/文书）/ B CI 绿即收口 / C 账本约定即止。
- **用户原回答原文**: 「A」
- **规范化需求**: 四段机器可复验收口：(i) 修红证据——T0 commit 真实双绿 run URL+isCloseout 收窄双向验证（direction 脱靶+round-67-closeout 仍命中）+main 复绿；(ii) 门面证据——README 双件 diff+heading 1:1/byte-identical 证明+机器路径 grep 零命中+badges 端点可达+docs/limitations.md 与 docs/adr/index 实物+gh repo view 元数据 JSON；(iii) 值守证据——ship-gate parity/limits 步红→绿证据对+gen-adr-index 重指向证明；(iv) 文书证据——ADR-0070+CONTEXT 新词+CHANGELOG+found/fixed/deferred 三元组（含 Q2 跳号过程违规自报、LICENSE Other 处置、顺手项逐条）+handoff+账本对账。
- **显式约束/负向需求**: 拒绝 CI 绿即收口（门面证据在 diff/文件/元数据不在 CI 态）；拒绝账本约定无锚点；顺手项必须逐条 found/fixed/deferred 显式处置不留悬置。
- **状态**: current
- **记录时间**: 2026-09-18

