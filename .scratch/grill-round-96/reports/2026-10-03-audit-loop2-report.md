# R96 审计 LOOP 2 — 返工复核报告（PASS，附 4 项文档级残留）

审计窗：2026-10-03（LOOP 2） | 复核对象：`r96-handoff-lint` 返工后状态（7 commit，amend 后 SHA 全改）
LOOP 1 报告：`.scratch/grill-round-96/reports/2026-10-03-audit-report.md`（下称「LOOP1」）
返工记录：`.scratch/grill-round-96/reports/2026-10-02-report.md` §10
职责分离：本窗仍只出报告，未改任何实现文件。

---

## 0. 结论

**PASS。** LOOP1 的 4 项阻断（B1/B2/B3/B4）**逐条复核为真修复**，非声明式修复 —— 全部回读源码确认，非仅读轮报自述。
残留 4 项**文档级**问题，其中 2 项在本审计窗自己的交接件里（自申报，见 §5）。**无阻断，可 land。**

---

## 1. 硬验收（返工后重跑，审计窗亲跑）

| #   | 命令                                                          | 实测                                                                                                                                                                    | 对照返工声明                                |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `pnpm -w turbo check build --force`                           | `EXIT=0`；`Tasks: 13 successful, 13 total`；`Cached: 0 cached, 13 total`；47.5s                                                                                         | ✅ 13/13、0 cached 吻合（耗时差为机器差异） |
| 2   | `node --import tsx --test test/handoff-lint-verdict.test.mjs` | `handoff-lint-verdict.test: 305 passed, 0 failed`                                                                                                                       | ✅ 逐字吻合                                 |
| 3   | `node --import tsx --test test/handoff-lint-e2e.test.mjs`     | `handoff-lint-e2e.test: 204 passed, 0 failed`                                                                                                                           | ✅ 逐字吻合                                 |
| 4   | `node --import tsx --test test/closeout-coverage.test.mjs`    | `closeout-coverage.test: 46 passed, 0 failed`                                                                                                                           | ✅ 逐字吻合                                 |
| 5   | 三套合计                                                      | **555 断言 / 0 失败**（返工前 310，**+245**）                                                                                                                           | ✅ 「上升、零删除」核实：断言数确实只增     |
| 6   | `node scripts/ship-gate.mjs`                                  | `EXIT=0`，551s，**零 `[fail]`**                                                                                                                                         | ✅                                          |
| 7   | 门禁关键腿                                                    | clean-tree ✅ / closeout-claims **21/21** ✅ / gen-adr-index 97 ✅ / closeout-coverage 21/21 ✅ / path-lint **610 docs clean** ✅ / handoff-lint 1 GREEN + 1 PENDING ✅ | ✅ 逐条吻合                                 |
| 8   | claims 独立复推（**自建 harness，不复用门禁实现**）           | **21/21 绿**                                                                                                                                                            | ✅ 与门禁读数独立吻合                       |
| 9   | fixtures 实际计数                                             | **27**（返工前 20，+7）                                                                                                                                                 | ✅ 与轮报 §1#4 的「27」吻合                 |

**结论：9/9 复现，零虚报。**

> **审计窗自身失误（第二次，已自纠）**：本窗首跑把 `turbo check build --force` 与三套测试**并发**执行，触发 `dsh-plugin`/`mcp` 构建 **JavaScript heap out of memory**（exit 9）。经单独重跑确认 `EXIT=0 / 13/13` —— 该 OOM 系审计窗自身并发争用所致，**非工件缺陷**。连同 LOOP1 记录的 claims harness 类型比较缺陷，本轮审计窗自身失误共 2 起，均已当场发现并自纠，记此以免下轮重蹈。

---

## 2. 四项阻断的逐条复核（回读源码，非读自述）

### B1 → 已修 ✅

- `scripts/handoff-lint-verdict.mjs:290` `const refsOk = !!(env && env.git && env.git.ok === true)`；`:296`/`:306` 在 `refsOk`/`wfOk` 为假时 `annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "ref-unavailable"))`，**不再**落到 `verifiedPending: true`（`:302`/`:316` 的 `verifiedPending: true` 现在只在事实确实读到时可达）。
- **超出返工声明的加强**：`:336` GREEN 路径的栈成员集查找也加了同一守卫 —— `env.git.ok === true && env.git.stackBranchMembers`。即「GREEN 声明在 git 失效时也会降级而非误判」，这是返工声明里**没有明示**的一条，同向加固。
- fixture `pending-stack-unpushed-git-down.json` 在位（27 个之一）。

### B2 → 已修 ✅

- `:292` `const wfOk = !!(env && env.workflows && env.workflows.ok === true)`；`:306` 降级标注；`:314` 的 `declaration-fact-conflict` 现在要求 `wfOk` 为真才敢下结论。
- fixture `pending-pushed-no-branch-runs-workflows-down.json` 在位。

### B3 → 已修 ✅（本轮最实质的一项）

- `emitCode(vocabulary, code)` 在 `:92-99`：`if (!vocabulary.includes(code)) throw ...` —— **是真抛错的 fail-closed 闸**，不是注释。
- **实测发射点全覆盖**：全文件 `emitCode(` 调用点 = **28 个**，与返工声明的 28 逐字吻合。
- **穷举反查**：全文 `redCodes:` / `annotations.push(` 中**不经 `emitCode` 的仅 2 处**，且都是空数组初始化（`:251` 的 `base`、`:478`），不构成码发射。故「28 个发射点全部经守卫」成立。
- `CODE_GROUPS`（`:80-88`）注册全部 7 个受治理词表（含新增 `stackAdvisory`），`isKnownCode`（`:103`）跨组查询。
- **这确实把 ADR-0097:29「扩词表须改门禁代码」从注释变成了可执行不变量。** LOOP1 B3 的判断（常量是装饰性的）现已不成立。

### B4 → 已修 ✅

逐码三面覆盖实测（单测 / E2E / fixtures）：

| RED 码                             | unit | e2e | fixtures | LOOP1 状态 |
| ---------------------------------- | ---- | --- | -------- | ---------- |
| `run-url-section-missing`          | 3    | 1   | 2        | 0/0/0      |
| `run-url-state-ambiguous`          | 1    | 1   | 2        | 0/0/0      |
| `run-url-unparseable`              | 2    | 1   | 2        | 0/0/0      |
| `stack-chain-empty`                | 2    | 1   | 2        | 0/0/0      |
| `run-url-state-line-missing`       | 1    | 1   | 1        | 0/0/1      |
| `declaration-fact-conflict`        | 2    | 1   | 2        | 0/0/2      |
| `stack-line-missing`               | 2    | 1   | 2        | 未列       |
| `green-claim-falsified`            | 2    | 1   | 4        | 1/0/4      |
| `pending-reason-out-of-vocabulary` | 3    | 1   | 1        | 2/0/1      |
| `but-id-not-resolved`              | 5    | 1   | 3        | —          |
| `sha-not-commit`                   | 5    | 1   | 3        | —          |
| `chain-tail-not-in-branch`         | 5    | 1   | 2        | —          |

**12/12 码三面均 ≥1，零覆盖分支清零。** D-004 的 OPA「允许+拒绝成对」在拒绝侧已有网。

---

## 3. 非阻断项复核（抽查，全部落地）

| 项    | 证据                                                                                                                                                                                                                                                                                        | 结论                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| N1    | `ref-unavailable` 已从 `api-failed` 拆出并入 `VERIFICATION_UNAVAILABLE_CODES`（`:296`/`:306`/`:338`），四种成因各有其码                                                                                                                                                                     | ✅                                                                                                 |
| N2/N3 | `run-url-section-missing`/`-state-ambiguous`/`-unparseable`/`stack-line-missing`/`stack-chain-empty` 入 `RUN_URL_RED_CODES`/`STACK_STRUCTURAL_RED_CODES`；`stale-capture` 独立为 `STACK_ADVISORY_CODES`（`:73`，注释明写「卫生信号，非不可证实」，与 ADR 定位一致）；模板新增机器可读词表块 | ✅                                                                                                 |
| N4    | `:351` `if (run.repo !== env.repo)` —— **严格相等**，`run.repo` 缺失即 mismatch ⇒ 不得 GREEN。LOOP1 记为「`run.repo &&` 可绕过」已消除                                                                                                                                                      | ✅                                                                                                 |
| N7    | `uniq`/标注投影去重；`deps.repo` 获消费者（E2E 断言在册）                                                                                                                                                                                                                                   | ✅                                                                                                 |
| R5    | 模板词表块 + E2E 双向集相等锁（模板组 ↔ `CODE_GROUPS`）                                                                                                                                                                                                                                     | ✅                                                                                                 |
| R6    | 收口件改用模板 Required header 骨架                                                                                                                                                                                                                                                         | ✅（门禁实测收口件仍判 `PENDING {run-url:stack-unpushed \| stack:ref-unavailable}`，非阻断、诚实） |
| R7    | ADR-0069 补指针行                                                                                                                                                                                                                                                                           | ✅（`grep -c 0097 docs/adr/0069-*.md` 由 0 变 3）                                                  |
| R8    | 模板缩进归位                                                                                                                                                                                                                                                                                | ✅                                                                                                 |
| R10   | 单测去真实仓依赖（冻结样本），真实数据断言迁 E2E                                                                                                                                                                                                                                            | ✅                                                                                                 |

**返工过程自申报的两处真实缺陷，核实为真且已修**：① `:251` `base` 现含 `redCodes`/`pendingSummary`/…（legacy 形状完整，壳层报告对 legacy RED 不再崩）；② `:383` `!Array.isArray(env.but.ids)` 与 `:398` `!env.git.commitObjects` 两处形状守卫在位（「未读事实当事实」的反向形态已堵）。两处均被新增回归网当场抓住 —— **这说明新网确实在干活，不是摆设**。

**两次 `rep()` 4 参吞代码行的自申报**：`:351` 与 `:336` 两行现均在位且语义正确。属实。

---

## 4. 措辞纠正复核（P1/P2/P3 —— 审计要求的核心）

| 审计要求                            | 轮报现状                                                                                                                                                                                     | 结论 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P1 撤回「F8 三缺陷闭环」            | §0 `:12` 加「**审计纠正（P1，2026-10-03）**」块，明写初版「不成立」，改述为「三态骨架落地；GREEN 路径与祖先性根除成立；PENDING 自证层的环境健康度校验已补齐」；§3 `:72` 同步撤回「永不静默」 | ✅   |
| P2 撤回「非形式走过」               | §5 `:109` 明写该自评「**不成立**」，逐条说明三种最弱形式的证明边界（含「`count` 类只证明某些词没被写进文件，**不证明运行时没调用**」）                                                       | ✅   |
| P3 拆开「全绿」与「闭环」的因果暗示 | §1 `:45` 加「验收边界」块，声明读数对应返工后代码、其后为纯文档 amend、文档面腿单独复验                                                                                                      | ✅   |

**纠正不是加脚注了事，是改掉了结论本身。** 这一点比 B1~B4 的代码修复更值钱 —— LOOP1 P3 记的正是「绿灯读数被当作闭环证据」这个过程问题。

---

## 5. 残留发现（4 项，均为文档级，不阻断 land）

### F1 — ADR-0097 Anchor caveat 的实测数字不可复现 ⚠️

ADR Status 记「`3642d494..HEAD` = 70 文件、`7454ba4b..HEAD` = 63 文件」。审计窗实测：**78 / 71**。两侧同差 8。

根因不是笔误，而是**测量目标本身会动**：workspace HEAD 是独立栈的合成合并 commit，实测合并了 **7 个栈** —— `r96-audit | r95-audit-loop2 | r95-audit | r96-handoff-lint+r95-exec+r95-rework | r96-grill-docs+r95-grill-docs`。其中 **2 个文件就是本审计窗自己的产物**（`2026-10-03-audit-report.md`、`round-96-audit-handoff.md`）。

**该 caveat 的定性判断是对的且重要**：树 scoped 两树 diff 确实无法隔离单轮（审计窗复核确认；返工方拒绝照抄 LOOP1 给的 `7454ba4b..HEAD`，自行实测后发现该范围同样不隔离，这个判断是正确的）。**但写进 ADR 的具体数字在写下当天即已失准**，且方向与 R95 F5R 教训同型：把一个会自行失效的实测值固化为立法文本。建议改为不含数字的表述（指向权威查询命令），或在返工笔记而非 ADR 承载该实测。

### F2 — 轮报 §6.3 的 fixture 计数陈旧 ⚠️

`:129` 仍写「`lqv`=判定核 + 单测 + **20 fixtures**」，而 §1#4 `:23` 写「同套 **27** fixtures」，实测 **27**。7 个新增 fixture 未反映进逐 commit 文件集描述。同一份报告内两处数字打架。

### F3 — 轮报 §8 suggested skills 仍指向不能隔离的基线 ⚠️

`:146` 仍建议 `$code-review` 对 `3642d494..r96-handoff-lint` 做双轴复核 —— 正是 R9/P5 判定为无法隔离单轮、且 §10.1 已加 caveat 的那个基线。报告在 §10 自我纠正后，§8 又把旧写法推荐给下一位接手者。

### F4 — 本审计窗 LOOP1 交接件的 7 个 capture SHA 已全部失准（自申报）

返工把 7 个 commit 全部 amend，SHA 全改（实测现 tip 为 `b734f25d` / `842478ed` / `68bd1634` …），而 `.scratch/grill-round-96/handoffs/round-96-audit-handoff.md` 的 Stack 行仍载 LOOP1 捕获值 `e77b35ef`/`8c8dd48d`/`8e2c86c0`/`03c6bd31`/`55699a4b`/`92abd9ee`/`8e63ee46`。

按模板「SHA time-lagged、but-id 为主键」，这**不是违规**；但按 R95 F5R 纪律（自造失效声明须追述），审计窗应当自己先改。**已在本轮 commit 内改正**（but-id 链 mwp→lqv→svk→lsp→ksz→zlr→lpu 不变，SHA 标注为 capture 时值并指向 `but log`）。

---

## 6. 处置建议

**准予 land。** F1/F2/F3 为文档措辞与计数，建议随下一次文档面 amend 顺手收割（无独立票 worth）；F4 已由本审计窗自行改正。

若 owner 认为 F1 的 ADR 数字必须立即纠正，则只需一条文档 amend + 复跑文档面门禁腿（path-lint / closeout-claims / gen-adr-index / closeout-coverage / handoff-lint），**不需重跑 code legs**（R95 先例：纯文档改动不重跑 check/build/test）。

---

## 7. 本窗边界（不追认）

- 未跑 CI 矩阵（本机不可代跑）。
- 未逐行复核 27 个 fixture 的语义正确性，只核三面覆盖计数与 `emitCode` 闸的存在性。
- 未复核 `emitCode` 的**负例**是否真被单测触达（仅确认闸在代码中且 28 点全覆盖；返工声明的单测 A 组「守卫抛错负例」采信未独立复跑该用例）。
- 未核 ADR-0097 Addendum A 的 A1/A2 条文与代码的逐码对应（仅核码集合与 `CODE_GROUPS` 一致性由 E2E 锁，ADR 文本侧采信返工声明）。
- 本窗自身失误 2 起（并发致 OOM、harness 类型比较），均已当场自纠，见 §1 尾注。
