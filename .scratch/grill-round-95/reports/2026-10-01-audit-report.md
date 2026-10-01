# Grill Round 95 — 审计报告（审计窗口，不动手修）

日期：2026-10-01 | 审计对象：R95 收口（`r95-exec` 分支）| 固定点：`3642d494`（= `main` = `origin/main`）
审计件：本件 | 审计交接件：`handoffs/round-95-audit-handoff.md`
被审对象：`reports/2026-10-01-report.md`（轮报）、`handoffs/round-95-closeout.md`（交接档）、账本 `decision-ledger.md`（D-001~D-005）

## 0. 审计结论

**CONDITIONAL FAIL → 建议打回原修复窗口返工**（5 项阻断项 F1~F5）。

工程实质**成立**：语料原位降格、四层机检、预注册时序、单次终读纪律、台账三记账均按 D-001~D-005 落地，全部回归锁实测为绿。
失效面集中在**报告真实性与证据可核性**——恰是本仓治理（audit-checklist 签字硬项 + CONTEXT Claims Freeze Point）所锚定的那一层。

返工代价低：F1~F5 全为文档/声明层，**不触及在线腿**（delta 终读档与 readout 结论不受影响，无需重跑 224 调用）。

## 1. 硬验收独立重跑（不信自述）

全部由审计窗亲自执行。**注意**：`pnpm check`/`pnpm build` 首次重跑命中 turbo 缓存（`FULL TURBO`），故追加 `--force` 强制真实重编。

| 验收项 | 轮报声明 | 审计窗实测 | 判定 |
|---|---|---|---|
| `pnpm check` | `CHECK_EXIT=0`，8/8 | exit 0，8/8；**强制未缓存 16.8s** | ✅ 证实 |
| `pnpm build` | `BUILDALL_EXIT=0`，5/5 | exit 0，5/5；**强制未缓存 19.1s** | ✅ 证实 |
| `node scripts/install-smoke.mjs` | `SMOKE_EXIT=0`，29 passed 0 failed | exit 0，**29 passed 0 failed**（独立重跑两次同值） | ✅ 证实 |
| `pnpm test` | `TEST_EXIT=0`，13/13 | exit 0，13/13（全量执行，非缓存） | ✅ 证实 |
| `node scripts/ship-gate.mjs` | 「补记后复跑该门禁即绿」（§6 注，预测） | **exit 0，全绿**；`closeout-coverage: 20 registered / 20 completed`、`handoff-lint`、`path-lint: 596 registered doc(s) clean`、`canonical-json`、`gen-adr-index: 96 ADRs at HEAD` 均 pass | ✅ 证实（预测兑现） |
| `readout-delta.mjs assert-corpus` | PASS，fp `8da3e482b98f8cba` | exit 0；`corpus fingerprint=8da3e482b98f8cba expected=8da3e482b98f8cba subjects=40 controls=16` | ✅ 证实 |
| `readout-delta.mjs selftest` | 7/7，indeterminate P=0.658 | exit 0，7/7 全 PASS；indeterminate `P=0.658` | ✅ 证实 |
| `verify-validator-vs-doc.ts` 离线 | `OFFLINE_EXIT=0` | exit 0，`DOC SIDE OK`（须 cwd=`packages/store`；自仓根跑会 `ERR_MODULE_NOT_FOUND: tsx`——交接档已给对命令） | ✅ 证实 |
| 终读档 sha256 | `28f509fb…eada0b` | `28f509fb345923633de0fd67e20f60978a95828491648295305f746570eada0b` | ✅ 字节级证实 |
| `apps/cli/.build-stamp.json` commit==HEAD | commit==HEAD | `commit=b955799c…`, `dirty=false`；等于当时 HEAD | ✅ 证实 |
| 报告 §2 全部 10 个 sha | 均为真实 commit | `git cat-file -t` 逐个 = `commit` | ✅ 证实 |
| 报告 §2 全部 but-id | 双锚 | `but status` 逐个命中 `trx/pnw/rsk/lyz/xut/znn/oql/umy/ouz/zpv` | ✅ 证实 |

**硬验收无一项造假。** 争议全部落在声明的**精度**与**可核性**。

## 2. 「声明 → 证据 → 结论」对照表

| # | 声明（出处） | 证据 | 结论 |
|---|---|---|---|
| 1 | 语料 diff 仅 f1105 一格（§2 T1） | `git diff 3642d494...r95-exec -- eval-looks.json`：3 hunk / 23 删除行，全部落在 `"vert-f1105": "live"` scope 摘除 + f1105 entry 体重写内；无他格 | ✅ **证实** |
| 2 | 指纹滚动 `7ac0a48e55cd7954`→`8da3e482b98f8cba`（§1/§2） | assert-corpus 实测 `expected=8da3e482b98f8cba` | ✅ 证实 |
| 3 | 切片 56 格（57→56） | assert-corpus：subjects 40 + controls 16 = 56；`eval-looks.json` entries 76 / scopes 75 / tombstoned 1 | ✅ 证实 |
| 4 | verdict/exit = INCONCLUSIVE/instrument-flag | `readout-output.json`：`verdict:"INCONCLUSIVE"`、`exit:"instrument-flag"`、G0 pass、G1 pass（unmeasured 4/16、nonTied 0）、G1b pass=false（`instrumentDown 30`, `n 40`, `maxDown 12`） | ✅ 证实 |
| 5 | 四字段 netWinRate=0.1 / P=0.7164 / EL=0.0451 / rankDiff 中位 0 | `readout-output.json` `matrix=grill-round-95/prereg-matrix@3`、`fingerprint=8da3e482b98f8cba` | ✅ 证实 |
| 6 | 探针档未进判读（登记为容量测量） | readout `artifact` 指纹 = `8da3e482b98f8cba`（终读档）；探针档指纹 `8bba68ae56f8cdb0`，结构不同，未过任何闸 | ✅ 证实 |
| 7 | R86 旧档保全，同 sha256 `4dcff270…`（§2 T5） | 文件**存在**于 `.scratch/vertical-eval/delta-r86-locked-2026-09-27.json`，实测 sha256 `4dcff270325ddc65b62fe8e129bdbf42b00e6833c34c920b2f89f6e9ef243462`——**哈希吻合**。但该文件 **git 未跟踪**，且路径在 `.scratch/grill-round-95/`、`docs/adr/0096*`、`docs/deferred-registry.json` 内 **grep 零命中** | ⚠️ **哈希真、证据不可核**（见 F4） |
| 8 | 台账 entries 42（closed 28 / open 13 / declined 1） | 实测 `entries: 42`，`{closed:28, open:13, formally-declined:1}`——**逐位吻合** | ✅ 证实 |
| 9 | 新 finding 独立 id、机检信号可跑 | registry 内 `type:"finding"` 条目**唯一一条** = `finding-r95-upstream-validator-vs-doc-vocab-mismatch`；离线信号 exit 0 | ✅ 证实 |
| 10 | r88-candidate 仅 carried_log、status 不动 | `status=formally-declined` 未动；末条 log 含条件③④ verifier 工件快照路径 | ✅ 证实（字段实为 6 键含 `round`，D-005 写「四字段集」，属**宽松达成**，非阻断） |
| 11 | `closed_by` 指针非悬空（D-005） | `closed_by_adr_path` 指向 `docs/adr/0096-…md`——文件存在，且正文 4 处具名该 entry id | ✅ 证实 |
| 12 | 判读器「非注释改动仅 FP+stamp 两处」（§2 T3） | 实测 **4 处非注释新增**：`EXPECTED_FP`、`out.matrix`、selftest fixture `{ subject: (m,i) => ({ verdict: i % 7 === 0 ? "better" : i % 9 === 2 ? "worse" : "tied", ...}) }`、以及 `+` 空行。**第三处改的是 better/worse 分布 → 直接移动后验** | ❌ **证伪**（见 F2） |
| 13 | 判读器机械面逐字不变（D-003） | 闸序 G0–G4（含 G1b）、flat-prior β 后验、效应量四字段、早停、单次终读——逐段比对**未变** | ✅ 证实（机械面本体成立，问题在自述计数） |
| 14 | T2 预注册先于任何跑数（D-005 时序自证） | 拓扑 `a9f2088e`(T1) → `04cdce5e`(T2) → `aee54914` → `0ae0c92b`(T4) → `4b9a1824`(T5)；mtime 一致（T2 10:28 < T4 10:33 < T5 10:40） | ✅ 证实 |
| 15 | 单窗口全量，未跨日合并/未缩范围（D-004 禁 C） | 终读档 `generatedAt 2026-10-01T02:39:25Z`、351s、rows=56，无分桶合并痕迹；56=40 主体 + 16 对照，与 G1 `n=16`、G1b `n=40` 自洽 | ✅ 证实 |
| 16 | 墓碑载体「无 scope / 无 `expected.vertical` / 无注入 spec」（§5.1） | `scopes["vert-f1105"] = undefined` ✅；`expected.vertical` 已移入 `tombstone.prior_expected_vertical` ✅；注入 spec 已随 scope 一并摘除 ✅。**但** `expected.verdict:"answer"` + `minResults:1` **仍留在活体字段上** | ⚠️ 字面真、语义有漏（见 F3） |
| 17 | 未申报偏差：无（§6） | 栈内存在 `7a540900`「交接档 pathlint 修正——去 machine-local 空挂 marker」，其存在本身即证明 `729e3c36` 时 pathlint 腿**红过**并需返工；该事实轮报**未提** | ❌ **证伪**（见 F1） |
| 18 | 交接档 handoff-lint 必备字段齐备 | `ship-gate` `handoff-lint` 腿 **pass**——但模板要求的两项（Stack 带 but-id、未推送写 PENDING）实际都不满足 | ⚠️ 门禁**假绿**（见 F5/F8） |
| 19 | 跨平台由 CI 承接 | 本轮 diff 纯 JS/TS + JSON + MD，无原生绑定；本机 win32 全链实测 | ✅ 接受（无法在本窗证伪，声明合理） |

## 3. D-001~D-005 逐条核对（声明 → 缺失/弱化/跑偏）

| 决策 | 规范化需求（摘要） | 实现证据 | 判定 | 缺失/弱化/跑偏 |
|---|---|---|---|---|
| **D-001** | R95 正题=评测矩阵修订轮；不动加权轴；不单边宣称方向复活 | 加权轴未动（`formally-declined` 维持）；corpus unfreezing + 读数重跑均落地；ADR-0096 立卷 | **SATISFIED** | 无 |
| **D-002** | f1105 原位降格 57→56 + 墓碑理由码受控；**语料 diff 仅一格**；**禁 B 同 id 换芯**；**expect 禁落运行期不存在的语义（Pact Golden Rule）** | 语料一格 ✅；新 id 换芯禁令被遵守（fundamental×cn_code 登记 backlog 未换芯）✅；理由码受控词表 + 四层机检 ✅。**但墓碑体仍携 `expected.verdict:"answer"`/`minResults:1`——任何 lane 都无法产生该期望** | **PARTIAL** | **弱化**：Pact Golden Rule 负向约束被自身实现违反；validator 只禁了 `expected.vertical` 半边，`verdict` 半边无机检 → **F3** |
| **D-003** | 判读器机械面逐字不变；**仅** EXPECTED_FP + matrix@3 戳 | 机械面本体未变 ✅；但 selftest fixture 被改（`i % 9 === 2`），属「仅…两处」之外 | **WRONG（对自述）/ 实体 PARTIAL** | **跑偏**：第三处改动移动了合成后验，prereg §10 与轮报 §2 双双把它记为不存在 → **F2** |
| **D-004** | LIMIT=4 探针先行、登记为容量测量；触发 nudge → 不硬跑、合法落 INCONCLUSIVE-instrument；不跨日合并、不缩范围 | 探针档独立（fp `8bba68ae`）未入判读 ✅；终读未硬跑、按 G1b 谓词落 INCONCLUSIVE ✅；单窗 351s ✅ | **SATISFIED** | 无 |
| **D-005** | T2 时序自证；r88-candidate 只记 carried_log；`closed_by` 不悬指针；Known-Risks 预写三项；G1b 谓词禁临场拟 | 时序 ✅；r88 status 未动 ✅；指针 4 处具名 ✅；Known-Risks 三项先于读数 ✅；G1b 谓词锚在 T2 ✅。**但 T5 的 R86 保全证据未入 diff、路径未披露 → 「三方可核」打折** | **SATISFIED（有保留）** | **弱化**：R86 保全件 untracked + 零披露 → **F4**；另**一票一 commit** 破例（轮报票 3 commit）→ **F6** |

## 4. 阻断项（建议打回返工）

### F1 — 「未申报偏差：无」不成立
- **声明**：§6「未申报偏差：**无**（唯一超 board 动作是 §5 三件实现裁量，均已回报入档）」。
- **证据**：`but status` 显示轮报票有三个 commit：`9454a182`(szw) → `729e3c36`(xlu) → `7a540900`(wzw)`。末者标题即「交接档 pathlint 修正——去 machine-local 空挂 marker」；空挂 marker 触发 `scripts/ship-gate-pathlint-detect.mjs`（`a marker on a line with no machine-local path — remove it`）。故 `729e3c36` 时 pathlint 腿**实际红**，需返工 commit 才能转绿。轮报 §4 只把 **closeout-coverage** 一腿写成「预期红」，**pathlint 一腿只字未提**。
- **违反**：`docs/agents/audit-checklist.md:23`「签字 commit 上 ship-gate --quick exit 0 …『gate 跑了但没人等它』属失守模式」；`CONTEXT.md` Claims Freeze Point `_Avoid_: 未申报偏差当正常`。
- **修复要求**：§6 增列一条申报偏差——「`729e3c36` 时 pathlint 腿红（空挂 marker），经 `7a540900` 返工转绿」。申报偏差本身不否决轮次（RR Stage 2 纪律），**未申报才否决**。

### F2 — §2 T3「非注释改动仅 FP+stamp 两处」证伪
- **声明**：§2 T3「非注释改动仅 FP+stamp 两处」。
- **证据**：`git diff 3642d494...r95-exec -- .scratch/grill-round-85/readout-delta.mjs` 非注释新增共 4 处，第三处为 selftest fixture：
  `{ subject: (m, i) => ({ verdict: i % 7 === 0 ? "better" : i % 9 === 2 ? "worse" : "tied", hOn: true, hOff: false }) }`
  该改动**重新分配 better/worse 占比**，直接移动 `P`。§1 确另处提到「n=41→40 fixture 重调」，但把它归为「n 漂移重调」，**未申报分布变更**；`prereg-matrix.md` §10「非注释改动仅 EXPECTED_FP 与 matrix 字符串两处」同证伪。
- **违反**：D-003 负向约束「仅 EXPECTED_FP 滚动 + matrix@3 版本戳」；`.scratch/grill-round-95/prereg-matrix.md` §10。
- **修复要求**：两处表述改为三处并具名 fixture 分布变更；补记该 fixture 变更对 selftest `P=0.658` 的影响已复核（我方实测 7/7 绿、indeterminate P 仍 0.658，故数值未漂，但**声明口径必须准**）。

### F3 — D-002 Pact Golden Rule 负向约束被自身实现违反
- **声明**：D-002 显式约束「expect 禁落运行期不存在的语义（Pact Golden Rule）」。
- **证据**：`eval-looks.json` 中 `vert-f1105` 墓碑体仍携 `"expected": { "verdict": "answer", "minResults": 1 }`。该格 `scopes` 缺失 ⇒ 无 lane 选中它；垂直 runner 另有 `expected?.vertical !== undefined` 双过滤；validator `docs-golden.ts:357` 只禁「墓碑行携 `expected.vertical`」，**`verdict`/`minResults` 半边无机检**。
- **违反**：D-002 负向约束。
- **修复要求**：二选一——(a) 墓碑体清除 `expected.verdict`/`minResults`；或 (b) 把 D-002 该条负向约束改写为「垂直面禁落运行期不存在的语义」，并在 `validateDocsGoldenEntry` 加断言固化。**并同步修 `.scratch/grill-round-84/gen-corpus.mjs` 的 `tombstone()` helper**，否则下次重跑语料会把该形状写回。
- **风险**：低（该格不可达），但属**自设约束未兑现**，在本仓「负向需求即契约」的治理语义下不可放过。

### F4 — R86 保全证据：哈希真、路径零披露、文件未跟踪
- **声明**：§2 T5「R86 旧档保全（同 sha256 `4dcff270…`）」；`prereg-matrix.md:53` 要求「复制 + sha256 记录入轮报」。
- **证据**：文件在 `.scratch/vertical-eval/delta-r86-locked-2026-09-27.json`，sha256 实测 `4dcff270325ddc65b62fe8e129bdbf42b00e6833c34c920b2f89f6e9ef243462` **吻合**；但 `git ls-files --error-unmatch` → **untracked**；`grep -rn 'delta-r86-locked' .scratch/grill-round-95/ docs/adr/0096*.md docs/deferred-registry.json` → **零命中**。sha256 已记、**路径未记**。
- **违反**：`prereg-matrix.md` §53 自定条款（路径未入轮报）；goal.md T8「三方可核」意图。
- **修复要求**：轮报 §2 T5 补该件仓内路径；并 `but` 提交该档（或入 `.scratch/grill-round-95/evidence/`）使保全件成为 diff 一部分。
- **注**：`.scratch/vertical-eval/` 未被 `.gitignore` 覆盖，故 `git add` 可行。

### F5 — 交接档 Stack 行与 run URL 双缺模板必备项
- **声明**：交接档 Stack 行「`r95-exec` on top of common base `3642d494` → main（未 land，未 push）」；绿色 run URL 段引 R94 祖先线 run。
- **证据**：`docs/agents/handoff-template.md:12-13`「Stack (primary key = GitButler change-ids)」、`:23-27`「but-id is the primary key… Cite but-id first, SHA second with its capture date」、`:28-32`「绿色 run URL — REQUIRED… If the runs do not exist yet (stack not pushed), write `PENDING — stack unpushed` explicitly; a missing/pending field is honest, an absent field is not」。实际 Stack 行**无任何 but-id、无 capture date**；run URL 段**未写 PENDING**，改引祖先线 `85403a20`。
- **减轻**：交接档散文已自陈「URL 引用已发表祖先线实证，非本轮新跑」——**披露诚实**，非隐瞒。
- **修复要求**：Stack 行补 but-id 链 + `@ <iso-date>`；本轮无 run 则显式写 `PENDING — stack unpushed`，祖先线 run 移作旁注。

## 5. 非阻断项（呈报 owner 裁定，审计窗不代追认）

- **F6 一票一 commit 破例**：轮报票三 commit（`9454a182`/`729e3c36` 主题几乎相同，`7a540900` 返工），与本轮自述纪律「一票一 commit」冲突。**呈报**：是承认返工 commit 例外，还是 amend 归并？
- **F7 未登记 closeout-claims.json**：R80~R94 全轮均有 `.scratch/grill-round-95/../closeout-claims.json`，**R95 无**。CONTEXT Claims Freeze Point 因无 claims 而**未被行使**。同轮又恰有未申报偏差（F1）⇒ R93-F1「门禁后补写 claims」同型风险敞口。**呈报**：是补登记，还是明确「R95 起 claims 制度停用」并同步 CONTEXT？
- **F8 handoff-lint 假绿**：`ship-gate` 的 `handoff-lint` 腿在 F5 两项缺失下仍 **pass**（原文：`1 closeout doc(s) carry 绿色 run URL + Stack and cite a run on this round's history`）——祖先线 run 被当作「本轮 history」接受。**呈报**：门禁盲区本身是否单独立 issue。

## 6. 已排除的怀疑（记录在案，避免下轮重查）

1. **改前轮工件**（`.scratch/grill-round-84/gen-corpus.mjs` +44、`grill-round-85/readout-delta.mjs` +16）——**非违规**。R86 有先例（`23de57a2` 改 r85 判读器，记于 ADR-0087）；ADR-0096 D1 已明载该改动。`.scratch` 为自由工件区。
2. **语料越界**——**无**。`eval-looks.json` diff 严格限于 f1105 足迹（见对照表 #1）。
3. **探针档污染判读**——**无**。两档指纹结构不同，探针未过任何闸。
4. **跨日分桶 / 缩范围终读**——**无**。单窗 351s，56=40+16 与各闸 n 自洽。
5. **claims 冻结点被追写**——**无适用**。R95 未登记 claims，规则无绑定对象。
6. **两 validator 作用域分支重复**——**有界、不可提取、属既有范式**。`DocsGoldenSet`（`docs-golden.ts`）无 `scopes` 字段，store validator 结构上无法承载该断言；分支内容亦不相同（validator 12 项字段检查 vs kernel 侧 scope 断言 + continue）。
7. **`expected.verdict` 为死重**——归入 F3，不单列。

## 7. 返工重跑清单（无论谁修，修完必须跑同一套）

**阶段一（文档层，F1/F2/F4/F5/F6）——不需要在线腿：**
1. `node .scratch/grill-round-85/readout-delta.mjs selftest` → 期望 7/7
2. `node .scratch/grill-round-85/readout-delta.mjs assert-corpus` → 期望 PASS，fp `8da3e482b98f8cba`
3. `pnpm turbo run check --force` → 期望 8/8 exit 0（**勿用缓存跑**）
4. `pnpm turbo run build --force` → 期望 5/5 exit 0
5. `node scripts/ship-gate.mjs` → 期望 exit 0，且 `handoff-lint`/`path-lint` 两腿须在 F5 修完后仍绿
6. `git status --porcelain` → 期望空

**阶段二（F3 触及语料生成器，必须跑）：**
7. 重跑 `.scratch/grill-round-84/gen-corpus.mjs` → 确认 `eval-looks.json` 仅 f1105 足迹变化（**若墓碑体形状改动则指纹会变 ⇒ `8da3e482b98f8cba` 失效 ⇒ matrix@3 作废，须重新预注册**）
8. `cd packages/store && node --import tsx ../../.scratch/grill-round-95/evidence/verify-validator-vs-doc.ts` → 期望 exit 0
9. `pnpm test` → 期望 13/13（重点 `eval-docs-golden.test.ts` 117/0 与 `eval-looks-stub.test.ts` 158/0）

> **F3 修复的指纹悬崖（务必先判）**：若采纳方案 (a)（清除 `expected.verdict`），`eval-looks.json` 字节改变 ⇒ 数据集指纹滚动 ⇒ **matrix@3 的 `EXPECTED_FP` 失效、单次终读矩阵作废**。届时须走「重新预注册 matrix@4 + 重跑全量」，**代价远高于本轮返工**。故建议 F3 采**方案 (b)**（改写约束 + 加 validator 断言，不动字节）——除非 owner 明确接受重跑。

## 8. 审计窗自证

- 审计全程**只读**：`git status --porcelain` 于收尾为空，`but status` uncommitted = `(no changes)`；未修改任何被审文件、未提交、未推送。
- 临时日志落在 OS 临时目录（非仓内），已清理。
- 双轴评审由两个并行子代理执行（Standards / Spec），其结论**已由审计窗逐条独立复核**（§2 对照表为本窗亲测，非转述）。
