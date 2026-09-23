# Round-79 任务书 — 「pathlint 豁免域契约收敛」实施

Date: 2026-09-23. 账本 `.scratch/grill-round-79/decision-ledger.md`（D-001~D-004 全 current，唯一权威数据源——任何实测与账本冲突→标 revised 呈报用户，禁止静默改向）；调研存档 `q1-atomcode.md`（主题定界/内聚三判据）、`q2-atomcode.md`（Codify vs Revert/豁免域先例普查）、`q4-atomcode.md`（收口判据三补丁）。Stack 约定：`r79-grill`（本文档）← 实施栈叠其上（GitButler 分支，与其他栈并行互不写）。

## 状态快照（接手即知）

- main tip=`f4031d23`（交接文书收尾），R78 三栈已 `but land` 进 origin/main（landed `5757e0ae`），工作区干净；registry 15 条=4 closed+11 open。
- **判定器现态**（`scripts/ship-gate-pathlint-detect.mjs`，R78 重构产物——行号以该文件为准）：`hitViolation` 仅在 `!fenceMarked && !isLocator` 时调用（`scanLines` 主循环内）→covered-fence 与 Stack: 行内 in-repo 检查整段跳过=豁免域未记账现状；`detectSurfacedSkips` 先于 fence 分支对每行产出 info=F-4 噪音源；`WORD_CHAR=/[A-Za-z0-9]/` 缺 `_`→`foo_C:\x` 形误报（WORD_CHAR 边界判定时 `_` 不算词字符，identifier 粘连盘符误命中）。
- **存量扫描实证**（取证脚本 `.scratch/grill-round-79/_scan-fence.cjs`）：fence 内 in-repo 绝对路径=0 实例（marked/unmarked 皆然）；locator 行 in-repo 活体实例≥1（`.scratch/grill-round-72/handoffs/next-round.md` Stack 行以绝对路径命名仓根——locator 职责即指地点）。
- **fixture 面**：`packages/store/fixtures/pathlint/{red,green}.md`（R78 建，token 类红绿成对+inline code 不豁免断言已在）；ship-gate step 1i 消费，驱动=config `scripts/ship-gate-pathlint.config.json`。
- **上游哨戒**：dsh `0.1.7-alpha.2` 于 2026-09-22T15:50Z 新发→L1 diff 义务到期；`0.1.5-rc.3`/`0.1.7-alpha.1` ≈2026-09-24 05:39/06:04Z 出闸；本批无 L2 合格候选（rc.3 特征锚缺席≡rc.2 零漂移、alpha.* 稳定锚不属 rc/stable 线）；`#1764` OPEN 且 2026-09-03 起无更新；transformers `4.3.0`。
- pnpm 配置面：`pnpm-workspace.yaml` `minimumReleaseAge: 2880`+`minimumReleaseAgeIgnoreMissingTime: false`（R78 加固已落）；`trustLockfile` 未设=默认 false。

## T0 — ride-along 上游取证（覆盖 D-001(3)+D-004(i)；纯证据零代码）

1. **L0**：`npm view @deepseek-ai/dsh-agent time version dist-tags --json` 快照落档；
2. **L1**：`0.1.7-alpha.2` tarball 消费面 diff vs 基线（Events 面：`agent/created` 携 `source`/`signal` 且 `agent/session-start` 缺席=特征锚在位预期；dep-closure 变化对照 R77 已录 21 个 dsh-* 枚举）；
3. **格式化结论行**（零发现也须显式，含观测窗口「截至」时间戳）：形如 `L0/L1 watch @ <ISO ts>: versions=<n>, feature-anchor=<present|absent>, line=alpha → not L2 candidate (stability anchor fails), action=none required`；
4. **rc.3/alpha.1 出闸态顺带复核**（npm view time 对表 ≈09-24 05:39/06:04Z 前后状态实录）。
- 归档 `evidence/t0-watch-alpha2.md`（+json 快照）；纯证据零代码不 commit 任何依赖面改动；意外（如 rc 线突携特征锚）如实呈报非静默。
- **验收**：transcript+格式化结论行+观测窗口时间戳三件套齐；`git status --porcelain` 对依赖面零脏。

## T1 — 豁免域契约收敛批（覆盖 D-002+D-004(ii)；一票三 commit）

文件面：`scripts/ship-gate-pathlint-detect.mjs`+`packages/store/fixtures/pathlint/{red,green}.md`+`docs/adr/0072-*.md`+`AGENTS.md`（「Deliverable path discipline」镜像段）+镜像一致性断言载体（ship-gate 或 fixture 断言，实现时定）。

1. **`fix(pathlint):` `/x` surfaced-skip 静默范围**=`detectSurfacedSkips` 产出移序到 fence/locator 判定之后——所有 fence 内（覆盖与否）+locator 行不再产 info；散文面照旧。红向：新增断言「fence 内 `/x` 零 info」改前实测失败（现态产 info）留输出片段→改后绿；近邻对照「散文 `/x` 仍产 info」不动；
2. **`fix(pathlint):` WORD_CHAR 补 `_`**（detect.mjs `WORD_CHAR` 字符集）——`foo_C:\x` 绿向 fixture（改前误报=红）↔裸 `C:\x` 红向仍拦（近邻对照）；
3. **`docs:` ADR-0072 豁免域条款修订+AGENTS.md 镜像同步**（契约文本与同票 impl 同批落地防再漂）——显式开列三豁免域各附 rationale（NIST tailoring 纪律）：①marker 覆盖 fence 内全部检查跳过（transcript 证据保真——摘录内容非交付引用，改写即失真）；②locator（Stack:）行内 in-repo 豁免（指地点语义+仓根无法 repo-relative）；③`/x` info 在所有 fence+locator 行静默（摘录/定位上下文非散文面）；**镜像一致性断言**=三豁免域关键词两载体（ADR-0072+AGENTS.md）双在位的 grep 级断言（挂 ship-gate step 或 fixture 断言，实现时定但必须有机器腿）。
- **近邻成对纪律**（D-004 补丁）：每个豁免断言携一线之差非豁免对照——covered-fence in-repo 放行↔unmarked-fence in-repo 仍拦；locator in-repo 放行↔非 locator 行同款仍拦；fence 内 `/x` 无 info↔散文 `/x` 仍产；`foo_C:\x` 不报↔裸 `C:\x` 仍拦。红态改前实测失败且失败原因与条款语义一致；不可区分者显式标 equivalent+理由呈报。
- **回归面**：stale-marker 棘轮不受影响（含 covered-fence-stale-marker 案回归）；存量文档扫描零新增违例（现态 319 文档净为基线）；inline code 不豁免断言不破。
- **验收**：红向改前实测（含原因语义核对）→改后绿；`pnpm run check`、`pnpm run test`、pathlint 腿直跑、`node scripts/ship-gate.mjs --skip-matrix`、`pnpm install` 全绿。

## T2 — 文书收口（覆盖 D-001 范围外记档+D-004(iii)；docs-only）

1. **ADR-0080**：豁免域契约三条款+drift 归因（文本侧=未审视笼统字面）+**rejected alternatives 段**（Revert 否决理由=transcript 保真损失+仓根实例+「为什么放弃保真」写不出；逐面混裁否决理由=立法负担同而内聚差）+豁免域扩大风险+三重缓解（一致性测试/stale-marker 棘轮 fail 级已实装/季度审计登记）+先例层级标注「结构性同构非规则级同构」（markdownlint 无路径语义规则）+**不 bump 判定**；
2. **registry**（canonical normalize 全程）：11 债 `carried_log` r79 续记+**E6→R80 候选显式记档**（`defer-r79-lockfile-agegate-replay` 新立条目或按 schema 最近似形态，主题=「发布龄期闸 lockfile 执法轮」：先实测 trustLockfile 验证腿在钉版 11.24.0 覆盖度 vs 本仓 E6 证伪张力，再定自建护栏/引用上游/显式记档）；
3. **handoff**（下轮候选序：R80 lockfile 执法轮>L2 合格候选等待>#1764 哨>外发闸）+**判据↔证据映射表**（每条收口判据↔佐证文件/commit/run URL）+**一行度量回写**（豁免域数=3/红绿对数/存量基线违例数）；
4. `.gitignore` round-79 白名单已随 grill commit 落；but 干净收尾。

## 红线

- 账本=唯一权威数据源；实测与账本冲突→原 D-xxx 标 revised+新 D-xxx 呈报用户拍板，禁止静默改向；
- 红向断言改前不红且不标 equivalent=呈报非放行；fixture 断言失败原因须与条款语义一致（防「判定器坏了式绿」）；
- E6/lockfile 护栏、trustLockfile 实测不属本轮（R80 候选）；#1764 评论与外发闸=用户动作项不动；
- functional change 不进 docs commit；T1 三 commit 原子性（impl/impl/docs 契约各自独立可 revert）；
- 写文件用 heredoc/ctx_execute fs（`$`/反斜杠断连前科）；commit 前自查新文档过 pathlint（本轮改的就是它——dogfooding 必须绿）。

## Suggested skills

`$implement`（票流驱动）· `$but`（版本控制）· `$atomcode-research`（R80 trustLockfile 预备调研）· `$handoff`（收口）· tdd/diagnosing-bugs（model-invoked：fixture 红绿纪律与判定器调试）。
