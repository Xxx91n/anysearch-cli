# Handoff — R96 审计 LOOP 2 → 修复窗（残留 3 项，可 land）

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
`r96-audit-loop2` → xqx（自引用收尾 commit：LOOP2 报告 + 本件 + LOOP1 交接件 SHA 追述；SHA 为自引用值，按 handoff-template「SHA time-lagged，以 but log」不写入）
LOOP 1 栈：`r96-audit` → zky（审计报告 + LOOP1 交接件）
被审计对象栈（返工后，**7 commit 的 SHA 已被 amend 全部改写**）：`r96-handoff-lint` → mwp → lqv → svk → lsp → ksz → zlr → lpu —— but-id 链与顺序未变，权威 SHA 以 `but log r96-handoff-lint` 为准；该栈叠于 `r95-exec` 之上（未 push、未 PR、未 tag）

## 绿色 run URL（必填）

PENDING: stack-unpushed — `origin/r96-audit-loop2` 无 ref（本审计窗未 push、未开 PR，符合「不 push 不 PR」纪律）；谓词可离线自证：`git rev-parse --verify --quiet refs/remotes/origin/r96-audit-loop2` 非零。

> 旁注（非本轮 run，不满足本字段）：共同基底 `3642d494` 的三条绿 run 仍是 main 基线 run，head_sha 不在栈成员集内 —— ADR-0097 三态语法下只作旁注。

## 已完成

**LOOP 2 报告**：`.scratch/grill-round-96/reports/2026-10-03-audit-loop2-report.md`（下称「LOOP2」）

### 结论：**PASS —— 4 项阻断全部真修复，3 项文档级残留，可 land**

### 1. 硬验收返工后重跑：9/9 复现，零虚报

`turbo check build --force` EXIT=0 / 13/13 / 0 cached · 三测试 **305 + 204 + 46 = 555 断言 0 失败**（返工前 310，**+245，零删除**核实为真）· `ship-gate.mjs` **EXIT=0 / 551s / 零 `[fail]`**（claims 21/21、path-lint 610 clean、closeout-coverage 21/21、clean-tree、gen-adr-index 97）· claims **21/21** 用审计窗自建 harness 独立复推 · fixtures 实测 **27**。

### 2. 四项阻断逐条回读源码复核为真修复（非采信自述）

| 票  | 复核证据                                                                                                                                                                                                               | 结论                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| B1  | `verdict.mjs:290` `refsOk = env.git.ok === true`；事实未读到即降级，`:302`/`:316` 的 `verifiedPending: true` 只在事实确实读到时可达。**且 `:336` GREEN 路径成员集查找也加了同一守卫**（返工声明未明示，同向加固）      | ✅                                                       |
| B2  | `:292` `wfOk = env.workflows.ok === true`；`:314` 的 `declaration-fact-conflict` 须 `wfOk` 为真才敢下结论                                                                                                              | ✅                                                       |
| B3  | `emitCode` 在 `:92-99` **真抛错**；全文件 `emitCode(` 调用点实测 **28 个**（与声明逐字吻合）；穷举反查「不经 emitCode 的 `redCodes`/`annotations.push`」**仅 2 处且均为空数组初始化**；`CODE_GROUPS` 注册全部 7 个词表 | ✅ ADR-0097:29 的 fail-closed **从注释变成可执行不变量** |
| B4  | 12 个受治理 RED 码三面覆盖实测 **全部 ≥1**（此前 4 码为 0/0/0），零覆盖分支清零                                                                                                                                        | ✅                                                       |

返工自申报的两处真实缺陷核实为真且已修（`base` 形状补 `redCodes`/`pendingSummary`；`:383` `but.ids` 与 `:398` `commitObjects` 形状守卫）。两次 `rep()` 4 参吞代码行的自申报亦核实为真（`:351`、`:336` 现均在位且语义正确）。**这些是被新增回归网当场抓住的 —— 新网在干活，不是摆设。**

### 3. N1~~N4 / N7 / R5~~R10 抽查全部落地

`ref-unavailable` 拆分（N1）· 4 个未立法 RED 码 + `stale-capture` 独立 `STACK_ADVISORY_CODES` 入 ADR 与模板（N2/N3）· `:351` 严格相等，repo 缺失即不得 GREEN（N4）· 去重 + `deps.repo` 消费者（N7）· 模板词表块 + E2E 双向集相等锁（R5）· 收口件 Required header 骨架且仍诚实判 PENDING（R6）· ADR-0069 指针行 `grep -c 0097` 由 0 变 3（R7）· 模板缩进（R8）· 单测去仓依赖（R10）。

### 4. P1/P2/P3 措辞纠正复核 —— 改掉了结论本身，不是加脚注

§0 加「审计纠正（P1）」块并改述终态；§5 明写「非形式走过」自评**不成立**并逐条声明三种最弱 forms 的证明边界；§1 加「验收边界」块拆开全绿与闭环的因果暗示。**LOOP1 P3 记的正是「绿灯读数被当作闭环证据」，这一条比 B1~B4 的代码修复更值钱。**

### 5. 残留 3 项（文档级，不阻断 land）

- **F1** ADR-0097 Anchor caveat 的实测数字不可复现：ADR 记 70/63，**实测 78/71**（两侧同差 8）。根因是测量目标会动 —— workspace HEAD 合并 **7 个栈**，其中 2 个文件就是审计窗自己的产物。**定性判断正确且重要**（树 scoped 两树 diff 确无法隔离单轮；返工方拒绝照抄 LOOP1 的 `7454ba4b..HEAD`、自行实测后发现同样不隔离，这个判断是对的），**但写进 ADR 的具体数字写下当天即失准**，方向与 R95 F5R 同型。建议改为不含数字的表述。
- **F2** 轮报 §6.3 `:129` 仍写「20 fixtures」，而 §1#4 写 27、实测 27 —— 同一报告内两处数字打架，7 个新增 fixture 未反映进逐 commit 文件集描述。
- **F3** 轮报 §8 `:146` 仍建议 `$code-review` 对 `3642d494..r96-handoff-lint` 复核 —— 正是 §10.1 已加 caveat 说无法隔离的那个基线。自我纠正后又在 §8 把旧写法推荐给下一位接手者。

## 下一轮候选

### R97 首要待办（owner 裁定后）

1. **F1/F2/F3 顺手收割**（纯文档，3 条行级改动 + 文档面门禁腿复验即可，**不需重跑 code legs**，R95 先例）。建议并入下一次文档面 amend，不单独开票。
2. **R97 正题建议：把 F1 的教训立法。** 三轮下来这是同一族缺陷第 3 次出现 —— R95 F5R（push 自造失效声明）、R96 P5（不隔离的基线锚）、本轮 F1（会自行失效的实测值写进 ADR）。**候选正题：「自造失效声明」作为一个可机检类别**（例如：凡写进 ADR/CHANGELOG 的实测数值，须同时给出权威查询命令或复现锚）。这与 ADR-0029 单题性相容，且比继续修门禁腿更有累积价值 —— 门禁腿 R96 已经修到位了。
3. **继承项**：`verification-unavailable:api-failed` 覆盖的成因是否再细分（ADR-0097 Known-Risk 5；N1 已拆出 `ref-unavailable`，余下成因待裁）。
4. **R97 正题备选**（若不取第 2 项）：另起新题，由 owner 选。

### 长期观察项（继承，两轮复核后仍成立）

- **三态语法 GREEN 分支的真实兑现仍未做过**。land 后首个 closeout 应以 `GREEN:` 引用该轮真 run URL —— **且此时 B1~B4 已修，GREEN 路径才真正有拒绝侧回归网**，是第一次有意义的兑现观察。
- **r95 栈 land 与 r96 重基**：r95-exec land `main` 后对本栈 `but pull`；land 后收口件的 `PENDING: stack-unpushed` 立即失效，须改述为真实拓扑（R95 F5R 教训）。
- **本分支叠在 `r95-exec` 之上**：直接 land r96 会连带 r95 的 18 个 commit。
- **`but status -fv` 行形是解析契约**（ADR-0097 Known-Risk 1）：but 升级改行形会退化为 `stack-unavailable`（env-PENDING，非误红），须在下次 but 升级时复核。冻结样本锚在 `packages/store/test/handoff-lint-e2e.test.mjs`。
- **CI 恒为 env-PENDING 是设计内非阻断**；监控锚＝`[skip]` 行计数异常升高。
- **`EFFECTIVE_SCOPE_FLOOR = 96` 是棘轮**：下调即整体退回 legacy，改动须 ADR。
- **写 markdown/JSON 禁 `String.raw` 携 `\uXXXX` 转义序列**（R96 事故，轮报 §6.2.3）。

## Known risks / deferred

### 本审计窗自身（自申报）

- **两起自身失误，均已当场自纠**：① LOOP1 claims harness 用 `===` 比较字符串与数字，把 5 条 `count` 类 claim 误报 FAIL；② LOOP2 首跑把 `turbo check build --force` 与三套测试**并发**执行，触发 `dsh-plugin`/`mcp` 构建 **JavaScript heap out of memory**（exit 9），单独重跑确认 `EXIT=0 / 13/13` —— 系审计窗自身争用，**非工件缺陷**。两起均已当场发现，记此以免下轮重蹈。
- **F4 已自行改正**：LOOP1 交接件的 7 个 capture SHA 因返工 amend 全部失准，本轮已在该件内追述（but-id 链不变，SHA 指向 `but log`）。按模板「SHA time-lagged、but-id 为主键」不构成违规，按 F5R 纪律审计窗应先改。

### 本窗未做（不追认）

- 未跑 CI 矩阵（本机不可代跑）。
- 未逐行复核 27 个 fixture 的语义正确性，只核三面覆盖计数与 `emitCode` 闸的存在性。
- 未独立复跑「守卫抛错负例」单测用例（仅确认闸在代码中且 28 点全覆盖）。
- 未核 ADR-0097 Addendum A 的 A1/A2 条文与代码逐码对应（ADR 文本侧采信返工声明）。

### 台账项（不越权立案）

- 上游 finding `--live` 重跑；fundamental×cn_code 新格；全语料契约体检。

### Suggested skills

- `$neat-freak` — F1/F2/F3 三项文档残留 + 返工面收尾（残留 / 文档同步 / 措辞追述），本轮最贴切。
- `$domain-modeling` — 若 R97 取「自造失效声明可机检类别」正题，需对齐 CONTEXT 词条区与 ADR 立法。
- `$gitbutler` — r95 栈 land 与 r96 重基（一票一 commit；禁裸 git 写）。
- `$code-review` — 若需再复核，用 **`but log` 的 commit 文件集**或路径 scoped diff；**不要用任何两树 diff**（LOOP2 F1 实测 3642d494..HEAD=78 / 7454ba4b..HEAD=71，两侧都不隔离）。
- `$handoff` — R97 收口交接。

## 交接件自检

- [x] 引用已有工件（路径）而非复述：LOOP2 / LOOP1 报告 / 返工记录 §10 / ADR-0097 / ledger / claims / 模板均以仓内相对路径引用。
- [x] 脱敏：无 key / 凭证 / PII。
- [x] suggested skills 已具名。
- [x] 与 `docs/agents/handoff-template.md` 同语法（ADR-0097 三态；Stack 行以 but-id 为主键）。
- [x] 交接焦点已按「残留 3 项 + R97 正题候选」裁剪。
