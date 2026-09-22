# R76-Q2 atomcode 调研存档 — closeout 必产断言的 fail-closed 修复设计

Date: 2026-09-22. Runner: `atomcode -p "$(cat q2-prompt.txt)"` via ctx_batch_execute (concurrency 1). Resume id: 6a20b384-8486-4bf0-a486-d5d7c0da8e61.

## 1) 执行摘要（TL;dr）

**推荐 A（ADR 登记作为完成信号）为正确方向，Confidence：高**——工业界对「latest-X fallback 掩盖缺失」类失效模的成熟处置就是 fail-closed 存在性断言 + 显式豁免记录，而区分在飞/完成的主流做法正是「产物登记表落盘」而非「目录存在」或 git 状态推断。但 A 需要三处加固：index.md 解析必须与 ADR 文件系统互为交叉验证（单信源解析是新的静默失效面）、floor 语义要锚定到「规则生日」且写入 ADR、并补一条终端情形兜底断言。

## 要点 1：silent-masking fallback 的成熟处置模式

工业界收敛到三个模式，全部指向 R70 F1 缺陷定性：

- **Fail-closed 存在性断言（"nothing to check" = failure）**：aiArch《Validating the Validator》——「把『没有东西可查』做成失败而非通过；一个定时任务报告健康却什么都没做，正是 gate 存在要打破的那种静默」；区分两种未防护失效：「我找不到它」（通常有防护）vs「我找到了但它是空的」（重构常产出、几乎从不防护）——我们的 bug 是后者变体：fallback 找到了上一轮 closeout，latest 目录为空却被当通过。「一个从未见过红的检查与一个不可能失败的检查不可区分」。(aiarch.dev/workflows/validating-the-validator, 全文已读)
- **显式豁免记录**：changelog-enforcer `skipLabels`、ao-kernel `chore-no-changelog` label+≥10字符 rationale、arc0 bypass marker（「bypass marker 是磁盘上唯一记录为什么的东西」）——豁免必须有载体、有理由、可审计，不允许隐式推导。
- **计数断言（assert the count）**：对「从别处推导检查对象」的检查，把数量本身作为断言打印在成功输出上——「让下一次静默缩减变成读者会注意的东西」。
- **Validator 自身 fixture**：known-bad/known-good 夹具先行——给这条腿写「最新 round 无 closeout」注入用例断言具体报错消息，否则修复后「绿」仍与「检查没跑」不可区分。

交叉验证：rediacc/console PR #478 同类「静默失败类缺陷」专门 lint + 意图性白名单注释（`# silent-failure-ok:`）；PlayMolecule 空 `expected_outputs.json` 曾致假 COMPLETED，修复=空推导信号 fail 向「未完成」侧——与裁决同构。

## 要点 2：完成信号选型——registry/index 落盘 vs 目录存在 vs git 状态

| 信号 | 代表先例 | 优点 | 失败模式 | 采纳度 |
|---|---|---|---|---|
| 产物登记表（registry/index 落盘，随代码提交） | changelog-enforcer git status A/M 判定、ao-kernel SSOT validator、ADR 生态 index 惯例（calm.finos.org、adr-kit）、Keep-a-Changelog [Unreleased] 段 | 确定性、可 diff、可 review、与豁免载体天然绑定 | index 与实际文件漂移（需双向一致性 lint）、解析脆弱 | **主流**——docs-as-code 事实标准 |
| 目录/文件存在 | madr-lint 扫 ADR 目录；PlayMolecule expected_outputs.json | 实现最简 | 「存在≠完成」——半成品/空目录/命名歧义全造成假阴性；方案 B 的终端静默正是其子集 | 只在产物粒度粗时可靠 |
| git 分支/tag 状态 | Sonar diff gate | 无需额外登记 | 与宿主分支模型强耦合（GitButler workspace HEAD=虚拟 commit）；squash/amend 下漂移 | VCS 语义明确场景可靠，作完成信号不可靠 |

裁决：registry/index 落盘是主流，前提是配**一致性 lint**（index 与文件系统双向校验）——adr-kit 把 index+lint 做成同一条链；单信源 index 不校验漂移=把静默失效从 closeout 缺失搬到 index 漂移。

## 要点 3：grandfathering 的 floor 锚定

- ratchet 生态（PHPStan baseline、ESLint bulk suppressions、Betterer、madr-lint、alint、gitleaks baseline、imbue-ai/ratchets）标准做法=「首个连续合规点」：启用当日 grandfather sweep，此后只有新违规 fail，旧账进显式 baseline 文件（指纹、可审计、只减不增）。
- **但我们场景语义不同**：ratchet 是「值可以旧」，closeout 存在性是「事件必须发生」。迁移结论：**floor 锚定到规则生日（本修复 ADR 落地轮）**——floor 前缺失不追溯，floor 后已登记完成的 round 必须有 closeout。存在性断言没有廉价伪造面。
- ratchet 腐坏警示：① baseline 可再生成=floor 可被重写——floor 常量必须由 ADR 载明纳入 review，不许脚本随手改；② 无人往下调——closeout 台账记录每次 floor 变更；alint `--accept-new` 反模式（重生成默认拒新增）值得抄：floor 调整走显式 review 路径。

## 要点 4：同类场景工业先例

| 场景 | 先例 | 映射 |
|---|---|---|
| per-PR changelog 必改 | changelog-enforcer（git status 判 A/M，fail 即红；skipLabels 显式豁免）；chlog（fragment missing → exit 1，"never skip it"） | 「已完成的变更单元必须有产物」=「已登记的 round 必须有 closeout」 |
| changelog SSOT 校验 | ao-kernel：CI 是 authoritative enforcement bound to SSOT validator，豁免走 label+rationale | ship-gate 应声明 SSOT（closeout 字段 schema），hook 与 CI 读同一 validator |
| stale/missing 条目污染下游 | opensearch k-NN #2970：「strengthen validation so stale or missing changelog entries cannot silently result in incomplete release notes」 | 与 R70 F1 同型：缺失被下游静默吞掉 |
| required status checks fallback 陷阱 | **最有共鸣先例**：GitHub 文档——path filter 跳过的 workflow「Associated checks stay in a Pending state」，永不报告的必需检查 vs 报告 Success 的跳过 job 是两种不同失效；主流修复=加无条件 gate job（`if: always()`），「gate 必须在不可被跳过的位置」 | 我们的 break-fallback 正是「gate 自己决定跳过」：修复后结构=gate 永远执行，对「在飞」产显式豁免结论（打印），对「已完成缺产」产红——豁免决策权从检查器内部猜测移到外部显式信号（ADR 登记） |

## 要点 5：方案 A 辩证审查与最终推荐

**A 的薄弱点（按严重度）**：

1. **单信源解析=新静默失效面**（最重）。index.md 是人写 markdown；若登记解析失败（格式漂移/表格列增删），腿退化为「永远判定在飞」=永久静默，比现 bug 更隐蔽。**缓解**：双向交叉验证——index 登记的每个 round dir 必须真实存在于 .scratch/，且 .scratch/ 中每个已完成 round dir 必须在 index 有条目；不一致即红。
2. **解析脆弱性**：不要正则硬解析表格列。匹配行数作计数断言打印；解析器对未知行形状 fail-loud 而非 skip（PlayMolecule：空推导结果必须 fail 向未完成侧）。
3. **登记时机盲区**：ADR 条目若在 closeout 产出前写入（提前登记）会瞬态红。需在 ADR 规定「登记即完成」纪律（本项目每轮收口必产 ADR 惯例支持），报错消息引导「要么补 closeout 要么移除登记」。
4. **GitButler 耦合度：实际很低**。信号全部来自工作区落盘文件（index.md+.scratch/），不读 git 历史/分支状态——这是 A 相对 git 推断的根本优势；hunk 级暂存的中间态与 ship-gate 无关（跑在落盘态）。**不构成反对 A 的理由。**
5. **豁免显式化**：在飞豁免不能只是隐式 break，应打印结构化豁免结论（round 号+「awaiting closeout / ADR not yet registered」），使豁免发生本身可观测。

**最终推荐：A + 四项加固**：① 信号=ADR index 登记（registry 路线）；② fail-closed 三断言：已登记(N≥floor)无 closeout→红 / index↔.scratch 双向不一致→红 / 推导集合为空或不可解析→红；③ floor 锚定规则生日（本修复 ADR 落地轮），floor 值写入 ADR、调整走显式 review；④ 验证纪律：known-bad fixture（注入「已登记无 closeout」断言消息）+成功输出打印 round 覆盖计数。B 仅作兜底留 fixture 反例；C 违背「修类不修例」且无必要。

## 信息缺口

- tavily 限额不可用，三引擎交叉降级两引擎（web_search+anysearch）+独立信源双重支撑；关键结论仍满足 ≥2 信源。
- PlayMolecule、arc0、k-NN #2970 三条仅摘要级未全文核验，但其结论已由 #1/#2/#4 全文独立支撑。
- ADR index 解析在 GitButler hunk 级暂存下的实际抖动无直接先例文献，属机制推理判断（低风险：ship-gate 只读落盘态）。

## 完整来源清单（15 条）

aiarch.dev《Validating the Validator》 · GitHub Docs Troubleshooting required status checks · latchkey.dev conditional-job-skipped 拆解 · changelog-enforcer README v3.2.1 · ao-kernel changelog-enforcement.yml · tim-schipper.nl《Quality ratchets for AI code》 · madr-lint adopting-existing-repo 指南 · alint baseline docs · adr-kit · calm.finos.org ADR linking tutorial · rediacc/console PR #478 · rjmurillo/ai-agents issue #1168 · arc0.me Sentinel File Pattern · PlayMolecule job lifecycle · opensearch k-NN #2970
