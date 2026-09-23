# Grill Round 79 — Decision Ledger

> 防丢账本：每条经用户确认的实质性结论当场追加。状态枚举：current/revised/stale/deferred。
> 唯一权威数据源——整理/压缩/handoff 前必须已落盘到最新。
## D-001 — R79 主题定界（atomcode 交叉后终审）

- **原问题**：Q1 终审——R79 主题定界：A=R79「pathlint 豁免域契约收敛轮」——立法主轴=F-3+F-4 合并为单个「豁免域契约」裁决（covered fence/Stack: 行内 in-repo 判定豁免域+`/x` surfaced 政策统一钉死，收敛方向留 Q2）；同域工程 commit=WORD_CHAR `_` FP 修复+红绿用例（refactor 粒度不进 ADR 主轴）；ride-along T0=0.1.7-alpha.2 L0/L1 哨戒取证（cadence 到期义务纯证据零代码）；E6 显式立项 R80 候选「lockfile 执法轮」（先实测 trustLockfile 覆盖 vs 本仓 E6 证伪张力再定自建护栏/上游依赖/记档）本轮记档不启动 / B=四件全打包（调研判杂物筐反模式已撤回） / C=残账 1/2/3 再拆三轮（过度拆分） / D=另取舍。
- **用户原回答原文**：「A」
- **规范化需求**：R79=「pathlint 豁免域契约收敛」轮，清算 R78 审计残账中同判定器域三件——(1) 立法主轴：F-3（in-repo 判定在 marker 覆盖 fence 内与 Stack: locator 行不生效——detect.mjs:143-151 hitViolation 仅在 !fenceMarked&&!isLocator 时调用，与 ADR-0072「markers 不豁免 in-repo」字面张力）与 F-4（detect.mjs:142 surfaced-skip 先于 fenced 分支产出→fence 内 `/x` 形 info 噪音）合并为**单个豁免域契约裁决**——同一契约问题的两面不拆开；收敛方向（ADR-0072 文本向实现收敛=Codify 显式立法 vs 实现向文本收敛=Revert 收紧）为 Q2 待裁项；(2) 同域工程 commit：WORD_CHAR 缺 `_` 边缘 FP（`foo_C:\x` 形误报——detect.mjs:38 词字符集不含下划线）修复+红绿用例，refactor commit 粒度不进 ADR 主轴；(3) ride-along T0：dsh 0.1.7-alpha.2（2026-09-22T15:50Z 新发）L0 快照+L1 消费面 diff 例行取证（defer-r73 cadence 到期义务），alpha 线非 L2 候选故纯证据零代码；(4) E6 证伪后果（lockfile 携闸内版 frozen/fetch 静默放行）显式记档为 R80 候选主题「发布龄期闸 lockfile 执法轮」——先实测 pnpm trustLockfile 验证腿在钉版 11.24.0 是否天然覆盖（调研文档级断言与本仓 E6 实证存在张力），再定自建护栏/引用上游/显式记档。 <!-- machine-local: 判定器源码行号引用（交接文书） @ 2026-09-23 -->
- **显式约束/负向需求**：凝聚轴=同文件/同决策类型/同验收面三判据（**同一次审计产出不是凝聚轴**——按来源打包=杂物筐反模式，CloudBase 批处理规则+CIS/Packetlabs 先例）；E6 不混入本轮（依赖管理域+护栏设计决策类型不同）；11 条落选债原名续记显式续债；#1764 观察哨（OPEN 20 天趋僵）与外发闸两份 draft 续挂用户动作项；调研 trustLockfile 文档断言不采信为本仓事实（与 E6 实证张力留 R80 实测）；grill 期间不动源码；本轮不设其他目标；rc.3/alpha.1 ≈09-24 06:0xZ 出闸但本批无 L2 合格候选（rc.3 无特征锚+alpha.* 稳定性锚不属）——触发器仍不响非抢跑。
- **状态**：current
## D-002 — 豁免域契约收敛方向（atomcode 交叉后终审）

- **原问题**：Q2 终审——豁免域契约收敛：A=Codify 显式立法（修 ADR-0072+AGENTS.md 镜像开列豁免域：①marker 覆盖 fence 内全部检查跳过=transcript 证据保真；②locator 行内 in-repo 豁免=指地点+仓根无法 repo-relative；③`/x` info 在豁免上下文静默——A1 仅 covered-fence+locator / A2 所有 fence+locator）+每条款一致性 fixture+豁免域扩大风险三重缓解诚实入 ADR / B=Revert 收紧实现穿透覆盖域 / C=逐面混裁 / D=另取舍。
- **用户原回答原文**：「采纳」（采纳 A2 变体）
- **规范化需求**：豁免域契约 Codify 显式立法，drift 归因在文本侧（IaC attribution 判据：三豁免域实现侧皆有正当理由——transcript 保真/locator 语义/仓根命名，文本是未审视笼统字面）。ADR-0072 修订+AGENTS.md 镜像段同步，显式开列三豁免域各附 rationale（NIST tailoring 纪律）：(i) marker 覆盖 fence 内**全部检查跳过**（含 in-repo/missing-marker/surfaced）——fence 内容=逐字机生摘录非交付引用，改写路径即篡改证据；marker 仍必需=声明块为机生上下文，unmarked fence 照旧执法（声明豁免模型同构 markdownlint disable→fence→restore 与 gitleaks 受审 artifact）；(ii) locator（Stack:）行内 in-repo 豁免——locator 职责指地点且仓根只能绝对命名（活体实例 R72 任务书）；(iii) `/x` surfaced-skip 在**所有 fence（覆盖与否）+locator 行**静默（A2 变体——fence 内容恒为逐字摘录非散文创作面，覆盖标记只治理硬命中语义）。一致性 fixture 钉死每条款（红：unmarked-fence in-repo 仍拦；绿：covered-fence in-repo 放行/locator in-repo 放行/fence 内 `/x` 无 info）。豁免域扩大风险+三重缓解（一致性测试+R78 已实装 fail 级 stale-marker 棘轮+季度审计登记）诚实入 ADR；先例层级如实标注「结构性同构非规则级同构」（markdownlint 无路径语义规则）。 <!-- machine-local: 判定器源码行号引用（交接文书） @ 2026-09-23 -->
- **显式约束/负向需求**：Codify 形态=ADR 修订+测试钉死，禁止代码注释静默追认；stale-marker 棘轮 R78 已实装（fail 级，强于 ESLint warn 先例）不重复立；marker 覆盖语义不变（覆盖=声明 excerpt，不覆盖=仍执法）；`detectSurfacedSkips` 静默范围=所有 fence 内+locator 行（散文面照旧产出）；不因豁免域扩大放宽硬拦语义；工业先例是结构性同构须如实标注不得拔高为规则级同构；WORD_CHAR `_` 修复与契约立法同属本票但分 commit（工程修正不进 ADR 主轴）。
- **状态**：current
## D-003 — R79 票序结构

- **原问题**：Q3——票序：A=T0 ride-along 取证（alpha.2 L0 快照+L1 diff，cadence 义务纯证据）→T1 契约收敛批一票三 commit（fix /x 静默+fixture；fix WORD_CHAR 补 `_`+fixture；docs ADR-0072 豁免域修订+AGENTS.md 镜像）→T2 文书收口 docs-only / B=T1 先行 / C=全并一票 / D=另取舍。
- **用户原回答原文**：「A」
- **规范化需求**：三票串行——T0 ride-along 取证（D-001）：dsh 0.1.7-alpha.2 的 L0 npm view 快照+L1 tarball 消费面 diff（Events 面 vs rc.2/前代基线）+显式结论记档（特征锚在位与否+alpha 线稳定性锚不属→非 L2 候选）+rc.3/alpha.1 出闸态顺带复核，transcript 归档 .scratch/grill-round-79/evidence/，纯证据零代码不 commit 任何依赖面改动。T1 契约收敛批（D-002）一票三 commit：fix(pathlint)=`/x` surfaced-skip 在 fence/locator 静默（detect.mjs surfaced 产出移序到 fence/locator 判定之后）+一致性 fixture；fix(pathlint)=WORD_CHAR 补 `_`+`foo_C:\x` 绿向 fixture；docs=ADR-0072 豁免域条款修订+AGENTS.md 镜像同步——契约文本与同票 impl 同批落地防再漂（立法行为本体非收口文书）；红向行使=两条 impl 改动的新 fixture 断言在改前皆红（fence 内 `/x` 无 info、`foo_C:\x` 不报皆现态失败）改后绿。T2 文书收口 docs-only：ADR-0080（豁免域契约+drift 归因+先例层级标注+豁免域扩大风险披露与三重缓解）+registry（11 债 carried_log r79+E6→R80 候选显式记档）+CONTEXT 新词+handoff（下轮候选：R80 lockfile 执法轮+watch 持续态+#1764 哨+外发闸）+.gitignore round-79 白名单+but 干净。 <!-- machine-local: 判定器源码行号引用（交接文书） @ 2026-09-23 -->
- **显式约束/负向需求**：T0 是带期排程债（per upstream release cadence）先清不积欠；T1 契约文本与 impl 同票落地（拆票即再漂窗口）；functional change 绝不混入 T2 docs commit；fixture 红向必须改前实测失败证明断言真实；T2 与 T1 依赖=文书内容引 T1 实测结果锁死最后。
- **状态**：current
## D-004 — R79 收口判据（atomcode 交叉后终审）

- **原问题**：Q4 终审——收口判据：A+=三段收口+三补丁（取证段补零发现格式化结论行+观测窗口时间戳；契约段补近邻成对 fixture+镜像一致性断言；文书段补判据↔证据映射表+度量回写+ADR rejected alternatives 段） / B=原 A 案不补漏项 / C=账本约定即可。
- **用户原回答原文**：「采纳」（采纳 A+）
- **规范化需求**：三段收口判据——(i) 取证段：alpha.2 L0 快照+L1 diff transcript 归档 evidence/+格式化结论行（特征锚在位/缺席+alpha 线非 L2 候选判定原文+观测窗口「截至」时间戳声明快照新鲜度——零发现也须显式结论行，SRE actionable-output 教义+on-call handoff watch items 惯例+Renovate Dependency Dashboard 先例）+rc.3/alpha.1 出闸态复核实录+意外如实呈报。(ii) 契约段：ADR-0072 豁免域条款+AGENTS.md 镜像同步落地；detect.mjs 两改（`/x` 静默范围=所有 fence+locator 行、WORD_CHAR 补 `_`）；**近邻成对一致性 fixture**（mutation testing 变体排除惯例——每豁免断言携一线之差非豁免对照：covered-fence in-repo 放行↔unmarked-fence in-repo 仍拦、fence 内 `/x` 无 info↔散文 `/x` 仍产 info、`foo_C:\x` 不报↔裸 `C:\x` 仍拦；红态须改前实测失败且失败原因与条款语义一致、失败输出片段留证；红态不可被近邻区分者显式标注 equivalent 并说明理由）+回归面（stale-marker 棘轮不受影响+存量文档扫描零新增违例）+turbo check/test+ship-gate+pnpm install 全绿+ADR↔AGENTS.md 镜像一致性断言（三豁免域关键词两载体双在位的 grep 级断言）。 (iii) 文书段：ADR-0080（含 rejected alternatives 段=Revert/逐面混裁否决理由+豁免域扩大风险与三重缓解+结构性同构先例标注+不 bump 判定）+registry（11 债 carried_log r79+E6→R80 候选记档）+CONTEXT 新词+handoff（R80 候选/watch 态/#1764/外发闸）+**判据↔证据映射表**（每条收口判据↔佐证文件/commit/run URL，compliance evidence-mapping 惯例）+一行度量回写（豁免域数/红绿对数/存量基线违例数，KRI 惯例）+.gitignore round-79 白名单+but 干净。 <!-- machine-local: 判定器边界用例引用（交接文书） @ 2026-09-23 -->
- **显式约束/负向需求**：三段缺一段不收口；红态不可区分又不标 equivalent=断言失真呈报非放行；零发现回合不许沉默通过；镜像一致性断言缺失=契约两载体漂移风险裸奔；度量回写只一行不过度；证伪/意外结果同样是合法收口产物；不 bump 判定须显式入 ADR。
- **状态**：current
