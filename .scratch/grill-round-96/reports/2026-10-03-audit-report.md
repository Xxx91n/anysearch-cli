# R96 审计报告 — 独立复核（CONDITIONAL FAIL：4 项阻断打回返工）

审计窗：2026-10-03 | 审计对象：`r96-handoff-lint` 栈（7 commit：`e77b35ef` `8c8dd48d` `8e2c86c0` `03c6bd31` `55699a4b` `92abd9ee` `8e63ee46`）
被审工件：`.scratch/grill-round-96/reports/2026-10-02-report.md`（下称「轮报」）+ `.scratch/grill-round-96/handoffs/round-96-closeout.md`（下称「收口件」）
立法依据：`docs/adr/0097-architecture-grill-round-96-handoff-lint-three-state-exit-semantics.md` + `.scratch/grill-round-96/decision-ledger.md`（D-001~D-005）
职责分离：本窗只出报告，未改任何实现文件。发现项处置见 §7。

---

## 0. 一句话结论

**编译 / 打包 / 启动测活 / 三测试 / 门禁全跑 / 15 条 claims —— 全部亲跑复现为绿，无一条虚报。**
**但绿灯来自断言覆盖面，不是实现正确性**：双轴评审坐实 **4 项阻断缺陷**，其中 2 项是 F8-b「静默折叠」的同一缺陷在下一层原样复现 —— 门禁在环境不可用时会把**不可证实**的 PENDING 报成**已证实**的 PENDING。轮报 §0「F8 三缺陷闭环」与 §3 对 F8-b 的收口结论**不成立**。

---

## 1. 硬验收亲跑复现（不信自述，逐条重跑）

| #   | 轮报声明                                    | 审计窗实测命令                                                | 实测读数                                                                                                                                                                                                                                 | 结论                                            |
| --- | ------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `turbo check build --force` 13/13、0 cached | `pnpm -w turbo check build --force`                           | `EXIT=0`；`Tasks: 13 successful, 13 total`；`Cached: 0 cached, 13 total`；`Time: 1m32.295s`                                                                                                                                              | ✅ 复现（耗时与轮报 1m9.744s 不同，属机器差异） |
| 2   | 真值表单测 138 断言                         | `node --import tsx --test test/handoff-lint-verdict.test.mjs` | `138 passed, 0 failed`，exit 0                                                                                                                                                                                                           | ✅ 逐字复现                                     |
| 3   | E2E 冒烟 126 断言                           | `node --import tsx --test test/handoff-lint-e2e.test.mjs`     | `126 passed, 0 failed`，exit 0                                                                                                                                                                                                           | ✅ 逐字复现                                     |
| 4   | 既有腿未破 46 断言                          | `node --import tsx --test test/closeout-coverage.test.mjs`    | `46 passed, 0 failed`，exit 0                                                                                                                                                                                                            | ✅ 逐字复现                                     |
| 5   | 门禁全跑 exit 0、9 步全绿、8m47s            | `node scripts/ship-gate.mjs`                                  | `SHIPGATE_EXIT=0`，`elapsed=828s`；末行 `ship gate green — ready to tag the next release`                                                                                                                                                | ✅ 复现                                         |
| 6   | 打包 8 包全 pass                            | ship-gate step 3/4                                            | kernel / embedding / store / retriever / cli / mcp / plugin / dsh-plugin 各 `[pass] packed`                                                                                                                                              | ✅ 8/8                                          |
| 7   | tarball shape + bin target ok               | ship-gate step 5                                              | 8 包 `tarball shape ok`；cli/mcp/plugin `+ bin target ok`；`npm install --prefix smoke ok`；`peer-optional dual-install ok`                                                                                                              | ✅                                              |
| 8   | 启动测活                                    | ship-gate step 6/8/9                                          | `[pass] T0 smoke probe: pref --help alive`；`[pass] MCP initialize: server=anysearch v0.1.0`；`[pass] fail-open boot ok: env scrubbed -> initialize green + stderr notice`；`[pass] packaged CLI/MCP observation trace round-trip green` | ✅ 三处测活全绿                                 |
| 9   | memory-eval 126/126、fp=4a529f6fbe2096c8    | ship-gate step 7                                              | `126/126 cases PASS, fingerprint=4a529f6fbe2096c8`；`eval fingerprint matches baseline`                                                                                                                                                  | ✅ 指纹吻合                                     |
| 10  | gen-adr-index 97 ADRs                       | ship-gate step 1b                                             | `docs/adr/index.md up to date (97 ADRs at HEAD)`                                                                                                                                                                                         | ✅                                              |
| 11  | closeout-coverage 生效域注册生效            | ship-gate step 1g                                             | `closeout-coverage: 21 registered / 21 completed round(s) at floor 76`                                                                                                                                                                   | ✅                                              |
| 12  | claims 15/15 绿                             | 自建 harness 逐条复推（不复用门禁实现）                       | **15/15 绿**，值逐条吻合（fixtures 实测 20 个）                                                                                                                                                                                          | ✅ 独立复现                                     |

**硬验收结论：12/12 复现，零虚报。** 轮报 §1 的读数可信。

---

## 2. 「声明 → 证据 → 结论」对照表（轮报关键声明抽查）

| 轮报声明（出处）                                                         | 实物证据                                                                                                                                                            | 结论                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| §0「F8 三缺陷闭环」                                                      | F8-b 声称「环境不可得时改 env-PENDING + 具名降级码，**永不静默**」；实测 `scripts/handoff-lint-verdict.mjs:246-254` 在 git 完全不可用时返回 `verifiedPending: true` | ❌ **不成立**（见 §3 B1/B2）            |
| §0「以真值表单测 + E2E 冒烟锁死」                                        | 138/126 断言确在；但 4 个 RED 分支零覆盖、6 个 RED 码零单测覆盖                                                                                                     | ⚠️ **弱化**（见 §3 B4）                 |
| §3「GREEN 四条件」                                                       | `verdict.mjs:299-302` 四条件在位且用 `memberSet.has(run.head_sha)` 成员性；全仓 `is-ancestor` 计数 0                                                                | ✅ 成立                                 |
| §3「run-URL 字段改一条显式状态行；散文 URL 不满足字段」                  | fixture `prose-url-only-rejected.json` → RED `run-url-state-line-missing`，实跑在册                                                                                 | ✅ 成立                                 |
| §3「PENDING 两码均为门禁离线自证」                                       | `verdict.mjs:246/256` 谓词在位；但自证**未校验环境健康度**                                                                                                          | ⚠️ **部分**（B1/B2）                    |
| §3「扩词表须改门禁代码（fail-closed）」                                  | `RUN_URL_RED_CODES` 等 5 个「封闭词表」常量在 `verdict.mjs` 内**各只出现 1 次**（即自身声明行），零守卫；码以裸字面量发出                                           | ❌ **不成立**（见 §3 B3）               |
| §5「15/15 复推绿……非形式走过」                                           | 15 条全为 `symbol`/`count`/`path` 三种最弱形式；无一条断言行为正确性                                                                                                | ⚠️ **自评不成立**（见 §6 P2）           |
| §6.3「7 个 commit 的文件集 = §2 表所列产物，无越界修改」                 | 逐 commit `--stat` 核：T1 22 files/2050 ins、T2 3 files/522 ins、T3/T5 各 1 文件、zlr 1 文件、lpu 3 文件。**吻合**                                                  | ✅ 成立                                 |
| §6.2.2「叠栈未插中，r95-exec / r95-rework 的 commit ID 与 sha 全部未变」 | `but branch list` 现仍为 `r96-handoff-lint ├─r95-exec └─r95-rework`；r95 侧 commit 未见改写                                                                         | ✅ 成立                                 |
| §8-2「本轮实现从未在真实 GREEN 路径上跑过」                              | 收口件 §2-2 同自认；ship-gate 实跑 `round-95-closeout.md [legacy] GREEN` 走的是 **legacy** 分支，非三态 GREEN                                                       | ✅ **诚实自认，审计窗不追认其为已完成** |

---

## 3. 阻断项（4 项，均经审计窗逐行复核代码确认）

### B1 —— git 不可用时，`PENDING: stack-unpushed` 被谎报为「已证实」【最严重】

- **位置**：`scripts/handoff-lint-verdict.mjs:244` + `:246-254`；`scripts/handoff-lint-shell.mjs:172-185`
- **机理**：壳层 `if (gitOk) { … }` 在 git 探测失败时**跳过整个循环**，`branchRefs` 保持初始值 `{}`（空对象，**不是 `null`**）。判定核 `:244` 取 `env.git.branchRefs ?? null` 得到 `{}`，`:247` 判 `refs === null` 为假 → `:251` `hasOwnProperty(refs, branch)` 为假 → 直接落到 `:254` `verifiedPending: true`。
- **判定核全程未读 `env.git.ok`**（`verdict.mjs` 唯一读 `.ok` 的三处是 `:278 env.gh.ok`、`:331 env.but.ok`、`:346 env.git.ok`——后者属 **Stack 腿**，非 run-URL 腿）。快照里 `git.ok` 字段是存在的（`shell.mjs:245`），只是没被消费。
- **违反**：D-003③「env-PENDING=显式标注非阻断」；D-002⑤「降级文案成因分流」。这正是 F8-b「不可证实与已证实为假混为一谈」的**同型复发**——只是从 run 层下沉到了 PENDING 自证层。
- **触发条件**：潜伏。仅当 `git rev-parse --git-dir` 本身失败时触发；正常路径下 git 可用，`branchRefs={}` 是**真事实**（该分支确实无 ref），此时 `verifiedPending: true` 是正确的。**但门禁恰恰只在环境失效时才必须不 over-claim**——该路径让降级静默消失，与本轮立法意图相反。
- **修法方向**（不代修）：壳层 git 失败时显式置 `branchRefs = null`；或判定核在 `refs === null || env.git.ok !== true` 时落 `verification-unavailable:*` 标注而非 `verifiedPending`。二选一，须补 fixture 锁「git 不可用 ⇒ 非 verified」。

### B2 —— workflow 读取失败时，`PENDING: pushed-no-branch-runs` 被谎报为「已证实」

- **位置**：`scripts/handoff-lint-shell.mjs:146-149` + `scripts/handoff-lint-verdict.mjs:257`、`:264-268`
- **机理**：壳层 `catch { ok = false }` 后仍返回 `{ ok: false, pushBranches: [], pushAllBranches: false }`。判定核 `:257` 只判 `wf === null`，**从不读 `wf.ok`** → `:264` `covered` 由空数组算出 `false` → `:268` `verifiedPending: true`。
- **违反**：D-002「谓词由门禁**离线自证**」。一个**读不出来**的目录不构成任何证明——「没有 workflow 覆盖该分支」与「没能读到 workflow」被折叠成同一结论。这是 F8-b 静默折叠的原始形态（把不可证实当已证实为假）在 PENDING 通道的残留。
- **触发条件**：潜伏。`.github/workflows` 缺失或不可读时触发。
- **修法方向**：壳层失败时返回 `null` 而非空对象，或判定核加 `wf.ok !== true ⇒ verification-unavailable` 分支 + fixture。

### B3 —— 5/7「封闭词表」是装饰性常量，ADR-0097 的 fail-closed 主张无守卫

- **位置**：`scripts/handoff-lint-verdict.mjs:40`、`:43`、`:50`、`:53`、`:56-64`
- **实测**（审计窗逐常量 grep 计数）：

  | 常量                             | verdict.mjs 内出现次数           | 是否被用作守卫 |
  | -------------------------------- | -------------------------------- | -------------- |
  | `PENDING_REASON_CODES`           | 3（声明 + `:228` + `:233` 消息） | ✅ 真守卫      |
  | `REQUIRED_WORKFLOWS`             | 2（声明 + `:301`）               | ✅ 真守卫      |
  | `RUN_URL_RED_CODES`              | **1**（仅声明）                  | ❌ 无          |
  | `STACK_RED_CODES`                | **1**                            | ❌ 无          |
  | `STACK_STRUCTURAL_RED_CODES`     | **1**                            | ❌ 无          |
  | `STACK_ENV_CODES`                | **1**                            | ❌ 无          |
  | `VERIFICATION_UNAVAILABLE_CODES` | **1**                            | ❌ 无          |

- **加重情节**：发出的标注串是 `"verification-unavailable:api-failed"`（`:248`/`:258`/`:288`/`:307`）与投影后的 `"run-url:" + a` / `"stack:" + a`（`:428-431`），**结构上永远不可能等于裸词表条目**。故即便补一个相等性断言也抓不到。
- **违反**：ADR-0097:29「不设 waived/time-boxed/doc-only 等人为豁免码——**扩词表须改门禁代码**（fail-closed，D-002①）」。实测：新增一个码**不需要**改任何常量，直接写字面量即可。本轮唯一的「封闭」不变量只有 PENDING 二元词表与 required workflow 两处成立。
- **修法方向**：把 RED 码与降级码的发出收敛为经常量断言的唯一出口（或加真值表断言「每个发出的码 ∈ 对应常量」），使常量成为可执行不变量而非文档。

### B4 —— D-004 的 OPA「允许+拒绝成对」对 4 个 RED 分支未兑现，6 个 RED 码零单测覆盖

- **实测**（审计窗逐码 grep 单测 / E2E / fixtures 三面）：

  | RED 码                                         | 单测 | E2E | fixtures | 判定          |
  | ---------------------------------------------- | ---- | --- | -------- | ------------- |
  | `run-url-section-missing`（`verdict.mjs:213`） | 0    | 0   | 0        | ❌ 三面零覆盖 |
  | `run-url-state-ambiguous`（`:220`）            | 0    | 0   | 0        | ❌ 三面零覆盖 |
  | `run-url-unparseable`（`:273`/`:276`）         | 0    | 0   | 0        | ❌ 三面零覆盖 |
  | `stack-chain-empty`（`:327`）                  | 0    | 0   | 0        | ❌ 三面零覆盖 |
  | `run-url-state-line-missing`                   | 0    | 0   | 1        | ⚠️ 仅 fixture |
  | `declaration-fact-conflict`                    | 0    | 0   | 2        | ⚠️ 仅 fixture |
  | `green-claim-falsified`                        | 1    | 0   | 4        | ⚠️ 覆盖薄     |
  | `pending-reason-out-of-vocabulary`             | 2    | 0   | 1        | ⚠️ 覆盖薄     |

- **违反**：D-004 规范化需求「每判定允许+拒绝成对用例（OPA 原则）」+ 负向需求⑤「OPA 核心要求：**防只测正路径的假绿**」。
- **为何是阻断而非建议**：一个零覆盖的 RED 分支，与一个**永不触发**的 RED 分支在证据上不可区分。D-004 立法的回归锁在最需要它的位置（拒绝路径）没有网。
- **附带**：单测 §A 只对 2 个码做 `includes` 断言，`RUN_URL_RED_CODES` 的 7 个条目中 5 个增删无红。
- **修法方向**：为 4 个零覆盖码各补「触发 → 期望 redCodes」的拒绝用例，并补「真值表全码 ⊆ 常量」断言。

---

## 4. 双轴 code-review 结论（Standards / Spec）

两轴由并行子代理执行，**全部发现经审计窗回读源码逐条复核**（剔除 1 条子代理误报，见 §4.3）。

### 4.1 Standards 轴

**硬违反（文档化标准）**

| #   | 位置                                                     | 标准                                                                                                                                                           | 判定                                                                                                                                                                                                              |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `scripts/ship-gate.mjs:1202` + `:1210`                   | ADR-0077 D2「nothing to check = 失败而非通过」；解析器 fail-loud 不 skip                                                                                       | ⚠️ **非阻断**：`targets.size===0` 已在 `:1194` 正确 skip+return。仅当 targets 非空但文件全部被删/改名时，`documents=[]` 仍打 `[pass] … across 0 closeout doc(s)`。窗口极窄                                        |
| S2  | `docs/adr/0069-*.md`                                     | `docs/deferred-registry.json:5` note 明文：「Old ADR bodies are never edited; **the pointer line lives in the old ADR**」（双向指针约定，Nygard/AWS/MADR/KEP） | ⚠️ **非阻断但应修**：`grep -c 0097 docs/adr/0069-*.md` = **0**。ADR-0069 D3 仍在宣示已被移除的「存在性 + 祖先性」规则，下一个接手者会读到过时规则                                                                 |
| S3  | `docs/agents/handoff-template.md:18-20`                  | AGENTS.md MD 结构政策（列表缩进/续行）                                                                                                                         | ⚠️ **非阻断**：`:18` 起的列表项在 `:19` 续行，而 `exist. No live verification runs for those rounds.` 顶格起始，从列表项脱钩                                                                                      |
| S4  | `.scratch/grill-round-96/**` 全轮无 audit-checklist 条目 | `docs/agents/audit-checklist.md` 的 Found/Fixed/Deferred 三元组惯例（`:83`、`:91-100`、`:124`、`:282-284` 等多轮先例）                                         | ⚠️ **判断题**：本轮改写了门禁腿本身，却未在 audit-checklist 留任何三元组记录。（注：子代理称「零 r96/0097 出现」**不准确**——`:231` 有 1 处偶发提及「本 repo r96 已修 dayBucketDefinition」，但确无 R96 审计条目） |
| S5  | R96 代码 diff 25 文件 / 2572 行（T1 22/2050 + T2 3/522） | `audit-checklist.md:11`「单轮审计覆盖的 diff 超过 500 行或 5 个文件时自动拆轮」                                                                                | ⚠️ **判断题**：该阈值治的是**审计轮**而非实现轮，故不构成硬违反；但体量已超阈值一个数量级                                                                                                                         |

**基线坏味（判断题，非硬违反）**

- **Primitive Obsession（实质项，与 B3 同源）**：5 个封闭词表常量是无守卫的字符串常量数组，概念无自己的类型。
- **Duplicated Code**：`uniq` 在 `verdict.mjs:91-93` 与 `shell.mjs:20-22` 逐字重复；`"run-url:"+a`/`"stack:"+a` 投影在 `verdict.mjs:428-431` 与 `shell.mjs:280-281` 建两遍。
- **Repeated Switches**：同一字符串三态在 `verdict.mjs:432-437`、`shell.mjs:273-286`、`ship-gate.mjs:1207-1208`（以 `kind === "fail"` 重推失败性）三处分支。
- **Message Chains**：`env && env.git && env.git.X ? … : null` 四次重复（`verdict.mjs:286`/`:367`/`:370`/`:383`）。
- **Speculative Generality**：`deps.repo`（`shell.mjs:206`）无任何测试消费者（E2E 只注入 `{spawnSync, workflows, now}`）。
- **Middle Man**：`evaluateHandoffLintDocuments`（`shell.mjs:255-261`）是纯 `.map` 包装。

**Standards 轴小结**：无「代码不符合标准」的硬伤；有 **2 处文档化标准未满足**（S2 双向指针缺失、S3 缩进脱钩），二者均应修但不阻断。坏味集中在 B3 已指出的词表弱类型。

### 4.2 Spec 轴

**已核验为绿**（子代理取证，审计窗复核）：判定核纯度（零 `spawnSync`/`fs`/`Date`/`process.env`）✅；PENDING 词表恰为二元且无第四态 ✅；GREEN 判定用成员性 `rev-list origin/main..origin/<branch>`，全仓零 `is-ancestor` ✅；新鲜度界仅落 annotation 永不 RED ✅；`EFFECTIVE_SCOPE_FLOOR = 96` 由文件名机检 ✅；快照形状壳核一致（E2E 同形注入）✅；收口件真实文档可按文档语法解析 ✅。

**缺失/部分** → B4（OPA 配对）、B3（词表 fail-closed）、**N1**（D-002⑤ 成因分流被压成单一 `api-failed`）。
**未要求的行为** → **N2**（4 个 RED 码未见于 ADR-0097 D1 与模板；`run-url-state-ambiguous` 属**发明出口**）、**N3**（`stale-capture:<id>:<n>d` 标注未入模板降级词表）。
**看似实现但实现不对** → B1、B2、**N4**（GREEN repo 合取项可绕过）、**N5**（单测 `:115` 读真实 `round-95-closeout.md`，违反 D-004「无仓库、无网络、无时钟下穷举」）。

### 4.3 子代理误报（已剔除，不计入结论）

- 「`docs/agents/audit-checklist.md` 零 r96/0097 出现」→ 实测 1 处（`:231`）。已改写为 S4 的准确表述。
- 「GREEN repo 合取项可绕过（`run.repo` 为 null 时跳过）」→ **成立但降级为 N4**：`shell.mjs:220` 的 jq 恒取 `repository.full_name`，真实 run 不会为 null，故为理论缺口而非可利用绕过。ADR-0097 D1 要求四合取，故仍列，但不作阻断。

---

## 5. 非阻断项汇总（建议同轮收割，不单独开票）

| #   | 位置                                                    | 问题                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | `verdict.mjs:248`/`:258`/`:288`/`:307`                  | `verification-unavailable:api-failed` 一个码覆盖 4 种成因（无 ref 事实 / 无 ref+wf 事实 / 无栈成员集 / 全部 run id 未解析）。ADR-0097 Known-Risk 5 只预登记了「gh API 失败」与「栈成员集不可得」两项，**未覆盖 `:248` 的 git-down 成因**——即 B1 的成因被 ADR 漏记。D-002⑤「禁共用单一 skip 文案」在此被削弱 |
| N2  | `verdict.mjs:57`/`:59`/`:60`、`:50`                     | `run-url-section-missing`/`run-url-state-ambiguous`/`run-url-unparseable`/`stack-chain-empty` 四码不在 ADR-0097 D1 的 RED 枚举、也不在模板。`state-ambiguous`（同段同时声明 GREEN 与 PENDING）是**发明出口**。这是 T3 要关的 F8-a 同类漂移，只是落在**判定码**面而非**书写语法**面                          |
| N3  | `verdict.mjs:390` vs 模板 `:108-113`                    | `stale-capture:<butId>:<n>d` 标注未进模板的封闭降级词表                                                                                                                                                                                                                                                     |
| N4  | `verdict.mjs:299`                                       | `if (run.repo && run.repo !== env.repo)` —— repo 为空则跳过该合取项                                                                                                                                                                                                                                         |
| N5  | `packages/store/test/handoff-lint-verdict.test.mjs:115` | 单测读真实仓内文件，违反 D-004「无仓库…穷举」                                                                                                                                                                                                                                                               |
| N6  | `.scratch/grill-round-96/handoffs/round-96-closeout.md` | 该件受**自己轮**的模板管辖，却未用模板「Required header」骨架（`## 已完成` / `## 下一轮候选` / `## Known risks / deferred`），改用 `## 0.`~`## 5.` 编号节。门禁不校标题故无红，但**新语法首件即未依新模板骨架**                                                                                             |
| N7  | `verdict.mjs` / `shell.mjs`                             | §4.1 坏味 6 项                                                                                                                                                                                                                                                                                              |

---

## 6. 过程违规呈报（审计窗不代追认）

| #   | 事项                                                                                                                                                                                                                                                                                                                       | 审计窗立场                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **轮报 §0/§3 的「闭环」措辞过强**。§3 对 F8-b 的收口结论原文为「环境不可得时改 env-PENDING + 具名降级码，**永不静默**」，而 B1/B2 坐实环境不可用时门禁**反而更静默**（谎报 verified，连降级标注都不打）                                                                                                                    | ❌ **不接受「闭环」结论**。正确表述应为「三态骨架落地；GREEN 路径与祖先性根除成立；PENDING 自证层的环境健康度校验缺失（F8-b 同型残留）」                                                                    |
| P2  | **轮报 §5 自评「15/15 绿……非形式走过」不成立**。15 条 claims 全为 `symbol`（token 包含）/`count`（字符串计数）/`path`（存在性）——**结构上无一条能捕获 B1~B4**：B1/B2 是「谓词缺失」类，`count` 类 claim 无法表达；B3 是「常量未被引用」类，`symbol` 类 claim 只查 token 在不在文件里；B4 是「分支无测试」类，无 claim 覆盖 | ⚠️ **claims 15/15 的事实为真，但证明力远低于轮报自评**。且 `r96-t1-core-purity-io`（spawnSync/process.env/fs. 计数为 0）只证明这些词没被写进文件，不证明运行时没调用——这类 count claim 的证明边界轮报未声明 |
| P3  | **轮报 §1「验证电池全绿」与 §3「闭环」并置产生因果暗示**。310 断言 + 15 claims 全绿与 4 项阻断缺陷并存。绿灯来自覆盖面而非正确性；轮报未声明覆盖边界                                                                                                                                                                       | ⚠️ 呈报。**这是本轮最值得记账的过程问题**：绿灯读数被当作闭环证据                                                                                                                                           |
| P4  | **「三态语法 GREEN 分支的真实兑现」从未做过**（轮报 §8-2 与收口件 §2-2 均自认）。F8-b 声称根治的正是 GREEN 路径的判定，而该路径零真实施跑证据；ship-gate 实跑中 `round-95-closeout.md [legacy] GREEN` 走的是 legacy 分支，非三态 GREEN                                                                                     | ✅ **自认诚实，审计窗不追认其为已完成**。列为 R97 首要观察项                                                                                                                                                |
| P5  | **ADR-0097 的 baseline anchor 不能隔离 R96**。ADR `:7` 记 `Baseline anchor: 3642d49445e5…(origin/main at round start)`，但本分支叠在 `r95-exec` 之上（轮报 §6.2.2 已具名申报），故 `git diff 3642d494..HEAD` 会扫进 R95 的 18 个 commit。**该纠正只写在轮报 §6.3，ADR 与收口件均未载**                                     | ⚠️ **呈报**。下一个接手者若照 ADR 的 anchor 做 diff，会得到错误范围（本审计即踩中：两轴子代理的初次 diff 都因此越界，已改用 `7454ba4b..HEAD` 重做）                                                         |
| P6  | **分支叠栈偏离 D-005④「新开 R96 分支」**                                                                                                                                                                                                                                                                                   | ✅ **已具名申报 = 非静默**，且已核验未插中、r95 侧零扰动。不追究                                                                                                                                            |
| P7  | **`$handoff` 落盘位置偏离 skill 默认**（收口件写入仓内而非 OS temp）                                                                                                                                                                                                                                                       | ✅ **已具名申报**，理由（`closeout-coverage` 腿以该路径为机械锚）成立。不追究                                                                                                                               |
| P8  | **字符写入事故**（`String.raw` 携 `\uXXXX` 落盘，5 文件）                                                                                                                                                                                                                                                                  | ✅ **自查发现并修复、按 GitButler 规则 amend 回各自提交、未留 fixup commit**。处理正确。教训（写 markdown 禁 `String.raw` 携转义序列）已在轮报 §7 与收口件 §3 记账                                          |

---

## 7. 处置建议（审计窗不动手，等 owner 裁定）

**建议：整体 CONDITIONAL FAIL，打回原修复窗口返工。** 理由：B1/B2 与本轮被修的 F8-b 同型，留它 land 等于把「门禁假绿」这一轮的产物本身带上同类假绿；B3 使本轮唯一的立法不变量（封闭词表 fail-closed）无守卫；B4 使回归锁在拒绝路径上无网。三者都是「实现存在但证明不足/语义相反」，不是补一行断言能了。

**返工清单（附修复要求）**

| 票  | 内容                                                                                                                 | 完成判据                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | B1：git 不可用 ⇒ 非 verified PENDING（壳层置 `null` 或核加 `env.git.ok` 守卫）                                       | 新 fixture「git down + `PENDING: stack-unpushed`」断言 state=PENDING **且** `verifiedPending !== true` **且** 带 `verification-unavailable:*` 标注 |
| R2  | B2：workflow 读取失败 ⇒ 非 verified PENDING                                                                          | 新 fixture「workflows.ok=false + `PENDING: pushed-no-branch-runs`」同上三条断言                                                                    |
| R3  | B3：封闭词表成为可执行不变量                                                                                         | 断言「每个发出的 RED 码 ∈ `RUN_URL_RED_CODES` ∪ Stack 集合」+「每个降级标注的裸码 ∈ 对应常量」；新增码而不同常量 ⇒ 红                              |
| R4  | B4：4 个零覆盖 RED 码各补拒绝用例 + 6 个零单测覆盖码补单测                                                           | 逐码 grep 三面计数均 ≥1                                                                                                                            |
| R5  | N1/N2/N3：降级码与 RED 码对齐 ADR-0097 与模板（`stale-capture` 入模板；四个未立法码要么入 ADR+模板、要么并入既有码） | 模板 ↔ 判定核词表逐项双向可核（建议加一条 claims 型断言锁双向相等）                                                                                |
| R6  | N6：收口件改用模板 Required header 骨架                                                                              | 标题与模板逐项一致                                                                                                                                 |
| R7  | S2：ADR-0069 补指向 ADR-0097 的指针行（按 registry note 的双向指针约定）                                             | `grep -c 0097 docs/adr/0069-*.md` ≥ 1                                                                                                              |
| R8  | S3：模板 `:18-20` 缩进修                                                                                             | 列表项续行不再顶格                                                                                                                                 |
| R9  | P5：把「基线 anchor 不隔离 R96，正确 diff 范围为 `7454ba4b..HEAD`」写进 ADR-0097 或收口件（不得只留在轮报）          | ADR 或收口件内可检出该纠正                                                                                                                         |
| R10 | N5：单测去掉读真实仓内文件的依赖                                                                                     | 改注入 fixture 后 `138+` 断言数变化，测试仍绿                                                                                                      |

**无论谁修（R1~R10 全部或部分），修完必须重跑第 1 条同一套验收**（12 项，逐字命令见 §1 表格第三列），**外加**：

```
cd packages/store && node --import tsx --test test/handoff-lint-verdict.test.mjs
cd packages/store && node --import tsx --test test/handoff-lint-e2e.test.mjs
cd packages/store && node --import tsx --test test/closeout-coverage.test.mjs
node scripts/ship-gate.mjs
```

断言数会因 R3/R4 上升——**上升是预期结果，不得为凑 138/126 而删断言**。若断言数下降，须在返工报告说明删了哪条覆盖、为何。

---

## 8. 审计窗方法与自身边界（诚实标注）

- **亲跑 vs 转述**：§1 全部 12 项由审计窗在本机实跑，读数为实测原文摘录。§2/§3/§4/§5 的每条发现均回读源码行确认（`verdict.mjs:244/246-254/257/299-302/346`、`shell.mjs:146-149/172-185/206/245`、`ship-gate.mjs:1194/1202/1210`）。§4.1/§4.2 两条子代理轴的输出**未直接采信**，逐条复核后剔除 1 条误报、1 条降级（§4.3）。
- **本窗未做（不追认）**：未改任何实现文件（职责分离）；未跑 CI 矩阵（本机不可代跑，轮报 §1.1 已诚实标注此边界）；未做真实 GREEN 路径兑现（P4，轮报已自认）；未核 `docs/adr/0069` 全文，仅核其 `0097` 指针缺失与 D3 表述；未逐行复核 20 个 fixture 的语义正确性（只核覆盖面计数）。
- **一处自身失误（已自纠）**：首轮 claims 复推 harness 用 `===` 比较字符串与数字，把 5 条 `count` 类 claim 误报为 FAIL（`actual=0 expect=0` 等）。已确认是我方 harness 的类型比较缺陷、非工件缺陷，改正后 15/15 全绿。记录在此以免下一审计窗重复踩坑。
