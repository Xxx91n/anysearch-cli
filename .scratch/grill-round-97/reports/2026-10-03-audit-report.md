# Grill Round 97 — 审计报告（审计 Agent，职责分离：只出报告不动手修）

- 日期：2026-10-03 | slug：`grill-round-97-audit` | 分支：`r97-selfcheckable`（审计时点：未 push、未 land；**后续 owner 授权 push，见文末 §7 时态追述**）
- 审计对象：`.scratch/grill-round-97/reports/2026-10-03-report.md` + 其引用的 handoff/账本
- 唯一事实源：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006 全 current）
- 审计方法：**不信报告自述**。全部硬验收亲自重跑（编译/测试/打包/门禁/测活），每条关键声明做仓库实物抽查（`rg`/存在性/字节比对）。双轴评审（Standards + Spec）用 `code-review` 技能派并行子 Agent，两轴结论再由审计 Agent 亲自复核后才采信。
- 原始日志：`.scratch/audit-r97/{check,build,test2,gate2}.log`

---

## 0. 一句话结论

**验收电池全绿属实——编译/测试/打包/门禁/测活逐条亲自复现，无虚报。**
**但「D-001~D-006 全覆盖」这一总声明被夸大**：实测 T6/T7 有 4 项账本要求未落或仅落散文，T3 的 ratchet 为装饰件，注册表/reuse 指针未被机器消费。双轴评审另发现 1 项假绿方向缺陷（报告级全量扫对未采集分支出 GREEN）。

---

## 1. 硬验收逐条重跑（声明 → 证据 → 结论）

| # | 报告声明 | 审计亲自重跑的证据 | 结论 |
|---|---|---|---|
| 1 | `turbo check 8/8` | `pnpm turbo check` → `Tasks: 8 successful, 8 total`，exit=0 | ✅ **证实** |
| 2 | `turbo build 5/5` | `pnpm turbo build` → `Tasks: 5 successful, 5 total`，exit=0（mcp DTS 30s 成功） | ✅ **证实** |
| 3 | `turbo run test 13/13` | 独占重跑 `pnpm turbo run test` → `Tasks: 13/13`，`ℹ fail 0` | ✅ **证实** |
| 4 | 真值表 `357/0` | `node packages/store/test/handoff-lint-verdict.test.mjs` → `357 passed, 0 failed`，exit=0 | ✅ **证实** |
| 5 | E2E `270/0` | `node packages/store/test/handoff-lint-e2e.test.mjs` → `270 passed, 0 failed`，exit=0 | ✅ **证实** |
| 6 | 8 包 tgz 齐 | `.ship-gate/pack/` 实测 8 个 tgz（cli/dsh-plugin/embedding/kernel/mcp/plugin/retriever/store，0.1.0） | ✅ **证实** |
| 7 | ship-gate `GATE_EXIT=0`、ship gate green | 独占重跑 `node scripts/ship-gate.mjs` → 独立 exit 文件 `REAL_GATE_EXIT=0`，末行 `[pass] ship gate green` | ✅ **证实** |
| 8 | claims `verbatim 2/2` | 门禁日志 `[pass] closeout-claims r97: 2/2 registered claims re-derived green`；字节比对两条 claim 的 `text` 均 `bytesMatch=true`、`reason` 非空、`reauthored=0` | ✅ **证实** |
| 9 | handoff-lint `1 GREEN / 2 PENDING / 3 docs` | 门禁日志 `[pass] handoff-lint: 1 GREEN / 2 PENDING across 3 closeout doc(s)` | ✅ **证实** |
| 10 | 收口件 PENDING{stack-unpushed} | 实测 `origin/r97-selfcheckable` ref 缺位；收口件 Stack 行 8 个 but-id（upo/pnq/spu/vrt/xvw/lop/lsz/krl）在 `but status -fv` 中**全部命中**；链尾 `1aedaee3` 确在 `r97-selfcheckable` 上 | ✅ **证实**（声明与实物相符，无自造失效） |
| 11 | CLI pref 测活 | `node apps/cli/dist/index.js --help` → `Usage: ans <command>`，命令表含 `pref  Manage T0 durable preferences (/remember, pref review - ADR-0024/0025)` | ✅ **证实** |
| 12 | MCP stdio `search_web` | 喂 initialize+tools/list 到 `apps/mcp/dist/index.cjs` → `stdio transport ready`，tools 首项 `name: "search_web"` | ✅ **证实** |
| 13 | 分平台断言 | `apps/plugin/test/*-contract.test.ts`（runner `node --import tsx`）：claude **10/0**、codex **11/0**、antigravity **13/0**、codebuddy **18/0**；适配器五面齐 | ✅ **证实**（报告「1/0」是文件计数口径，非断言数，见 §4-3） |
| 14 | memory-eval 离线 EXIT=0 | 门禁日志 `[pass] memory-eval: 126/126 cases PASS, fingerprint=4a529f6fbe2096c8, passRate=1` | ✅ **证实** |
| 15 | 「D-001~D-006（T0→T7）全覆盖」 | 见 §3 逐票对账：T0/T6/T7 有 4 项未落或半落，T3 ratchet 为装饰 | ❌ **夸大** |

**验收电池小结**：15 条硬声明中 14 条完全证实，**零虚报**。第 15 条是范围性总声明，问题在覆盖面而非绿度。
---

## 2. 双轴评审（code-review 技能；子 Agent 结论均经审计 Agent 复核）

固定点 `3642d494`，diff `git diff 3642d494..HEAD`，10 个 `(r97-t*)` commit。

### 2.1 Standards 轴（发现优先）

| 编号 | 判定 | 发现 | 复核证据 |
|---|---|---|---|
| S-1 | **[HARD]** | 报告级全量扫对**未采集**的分支出 **GREEN**（假绿方向）。`buildReportOnlyScan` 复用门禁 snapshot，而 `runHandoffLint` 只为门禁文档里出现的分支采集 ref；「没人问过所以 ref 缺」与「ref 确实缺」不可区分，`unpushed` 静默过。违反 next-round.md §0「环境不可用=env-PENDING 不静默过」 | ✅ 复核成立：`handoff-lint-shell.mjs:204-215` 采集循环只遍历门禁文档的 `branches`；`buildReportOnlyScan`(:288) 直接吃 `snapshot: result.snapshot`。非阻断（report-only），但方向是假绿 |
| S-2 | **[HARD]** | 裸词扫描的**代码 span/fence 豁免无任何断言守护**（next-round.md:37 明确要求）。实现正确但测试网漏 | ✅ 复核成立：`stripCodeSpansAndFences`(:282) 存在；测试仅 :398 覆盖**标记解析器**的 fence 规则，`collectBareWords` 的豁免零断言 |
| S-3 | [JUDGEMENT] | Duplicated Code：`ship-gate.mjs:1221-1228` 复刻 `:1211-1215` 的文档收集循环 + 路径拼接，采集逻辑漏进薄壳 | ✅ 成立 |
| S-4 | [JUDGEMENT] | Duplicated Code：`buildReportOnlyScan` 是 `buildHandoffLintReport` 计数半边的复制（`kind` 强制 `"info"`） | ✅ 成立 |
| S-5 | [JUDGEMENT] | Speculative Generality：`STATE_PREDICATE_REGISTRY` 全仓**仅 1 处引用 = 它自己的声明**，无消费方无测试；注释称「扩表须改此常量」，实为空转 | ✅ 复核成立：`grep -rn STATE_PREDICATE_REGISTRY` 仅 `verdict.mjs:46` |
| S-6 | [JUDGEMENT] | Primitive Obsession：`marker.args` 一串身兼「分支名 \| `"stack"` 哨兵」，字符串比较散落 | ✅ 成立 |
| S-7 | [JUDGEMENT] | 弱断言：`verdict.test.mjs:288` 接受 `PENDING \|\| RED`（近套套）；`:349` 重复断言 `:348` | ✅ 成立 |

**Standards 正面（通过项）**：判定核纯净性 ✅（`grep` 零命中 `spawnSync/child_process/fs/Date.now/process.env/require`，时钟以 `env.now` 注入）；门禁薄壳角色 ✅（无判定分支）；三谓词 fixture 成对 ✅（verified+conflict 各 3）；15 个 RED 码全部 fixture 可达 ✅。

### 2.2 Spec 轴（对 D-001~D-006 / T0~T7）

**已核实合规**：T1 立法先行（ADR-0098 落于 `b735a0cf`，早于实现 `f923be49`）；三元组/封闭注册表/3 项词表/生效域边界齐备；词表恰 3 项、无 `no-pr/unpublished` 泄漏；`docs/adr` 未入靶位（靶 = `.scratch/*/handoffs/*`）；N5 三 glyph 系统性扫描 + ADR-0097 Known-Risk 1 **带日期原位 errata**（实测明写「不 supersede」）；形态二腿未落 RED（约束③ 合规）。

| 编号 | 类 | 发现 | 复核证据 |
|---|---|---|---|
| P-1 | (a) | **T7「写完 next-round.md 的轮回版（R97→R98）」未落**：文件仍是 R97 任务书（首行 `# Handoff — Grill Round 97 任务书`）。且轮报 §4 称「R98 草案全文见附录A」，但报告全文 37 行、无附录A内容 | ✅ 复核成立：`next-round.md` 标题仍为 R97 任务书；报告 headings 仅 §0~§4 |
| P-2 | (a) | **T6「收口清算义务落地：机械条目『栈空 ∨ deferred 在册』」只落模板散文**，D-002 要求「**可机检**」；`scripts/` 内零实现 | ✅ 复核成立：`grep -n 'deferred\|栈' scripts/closeout-coverage.mjs` 零命中 |
| P-3 | (a) | **T5「机检腿 PENDING 位挂接」无代码**；deferred 票自认「机检实现未做，PENDING 位无挂接代码」，而 ADR-0098 D5 写「以 PENDING 位挂接」，**立法与实现不符** | ✅ 复核成立：deferred registry `defer-r97-morphology-two-ratchet` evidence 自述无挂接代码 |
| P-4 | (a) | **T0 land 未执行 → D-006 ①「land 先于一切实现 commit」被违反**（已申报，仍是账本偏离） | ✅ 成立：`origin/main` 仍 `3642d494`，0 新增 |
| P-5 | (a) | T6 CHANGELOG 未按「feat/fix/**docs(errata)**」分行，errata 混在 `### Fixed` 条内 | ✅ 成立：CHANGELOG 第 7-21 行实测仅 Added/Fixed/Deferred 三节 |
| P-6 | (c) | **T3 ratchet 是装饰**：`reauthored` 仅 `Number.isInteger && >=0` 校验（`ship-gate.mjs:872`），全仓无 recount、无比对、无上表面——「ratchet 可见的重批计数」未兑现 | ✅ 复核成立 |
| P-7 | (c) | **N5 放宽后误降级方向反了**：`parseButStatusIds` 以 `^([^\s\t])[ \t]+(id)` 匹配任意符号开头行，符号开头 detail 行即 `degraded=true` → `butOk=false` → Stack 元素静默失效（env-PENDING，fail-open）；E2E 未覆盖符号开头 detail 行 | ✅ 成立（方向确为 fail-open） |
| P-8 | (c) | **裸词英文枚举双源**：`STATE_BARE_RES` 硬编码于 `STATE_PREDICATES` 之外，扩表漏改即漏扫 | ✅ 复核成立：`verdict.mjs:45` 与 `:321-323` 两份独立字面量 |
| P-9 | (c) | **`reuse` 指针纯装饰**：字符串 `"parseWorkflowTriggers/collectWorkflowTriggers"` 无解析无校验；`no-branch-runs` 实走 shell 注入的 `env.workflows` | ✅ 复核成立：`grep '\.reuse'` 全仓零消费 |
| P-10 | (c) | **两速扫「分权不混」未完全成立**：报告级全量扫嵌在门禁 step 内并复用门禁 snapshot | ✅ 成立（与 S-1 同源） |
| P-11 | (b) | diff 基线混入其他栈内容：`91f5b173`（GitButler Workspace Commit，5 parents）带入 r95/r96 的 `.scratch` 证据与白名单 | ✅ 成立（工作区合并产物，非 R97 实现面） |
---

## 3. D-xxx 逐条核对（声明 vs 实现证据）

| 决策 | 声明覆盖 | 实现证据 | 判定 |
|---|---|---|---|
| D-001 | R97 双轨范围定界 | `goal.md` 定锚；B 轨仅预检（未授权） | ✅ 符合（未授权不执行，合规） |
| D-002 | B 轨 land + r95-rework 回收 + 轻量立法 | land 未执行（无授权，已申报）；收口条款落模板散文 | ⚠️ **部分**：立法面「可机检」未落码（P-2） |
| D-003 | 统一类别立法 + 形态一/三实现 | 三元组+封闭注册表+形态一状态腿+形态三 verbatim 齐备 | ⚠️ **部分**：形态三 ratchet 为装饰（P-6） |
| D-004 | 标记语法/目标面/词表 | 标记语法+自移靶位+两速分权+3 项离线词表齐备；bare-word 豁免实现正确 | ⚠️ **部分**：豁免无测试（S-2）、扩表双源（P-8）、reuse 无保障（P-9） |
| D-005 | N5 归属与修法三件 | 标记类放宽 ✅、三 glyph 扫描 ✅、ADR-0097 errata ✅（带日期不 supersede） | ✅ **三件齐备**（放宽后误降级方向见 P-7） |
| D-006 | 票序 T0→T7 + 簿记 | T1~T6 主干落盘；CHANGELOG+deferred 双票+索引回填在位 | ❌ **偏离**：T0 land 未先行（P-4）、T7 next-round 覆写未落（P-1）、形态二 PENDING 挂接无码（P-3）、CHANGELOG 未分行（P-5） |

**缺失/弱化/跑偏单列**：
- **缺失**：P-1（T7 轮回版 + 附录A）、P-2（清算义务机检）、P-3（形态二 PENDING 挂接）、P-4（land 先行时序）。
- **弱化（实现成装饰）**：P-6（ratchet）、P-8（裸词双源）、P-9（reuse 指针）、S-5（注册表常量无消费）。
- **跑偏/假绿方向**：S-1（未采集分支出 GREEN）、P-7（N5 放宽后误降级 fail-open）、P-10（两速扫未真正分权）。

---

## 4. 过程违规呈报（不替owner 追认）

1. **P-1 属交付件失准**：轮报 §4 明写「R98 草案全文见附录A」，但报告无附录A；`next-round.md` 仍是 R97 任务书。属**报告声明与实物不符**（非绿度虚报，是交付内容缺失）。T7 自报让位理由（grill-docs 分支拥有该文件、覆写引发 6 冲突已 undo）解释了为何未覆写，但**不能同时解释「草案全文已存附录A」**——附录A 不存在，草案全文下落不明。
2. **双声明失效预告**：收口件两处声明（文首 `unpushed` 标记 + GREEN run URL 段）注明「land/push 后同时失效，须按重锚仪式改述」。纪律正确，当前未 land/push 故自洽；一旦 B 轨 land 落地必须重锚。
3. **平台断言口径易误读**：报告写「claude1/0、codex1/0…antigravity13断言…cursor面17断言」，实测断言数为 claude 10、codex 11、antigravity 13、codebuddy 18。「1/0」是文件计数口径。数字本身不假，但与断言数混列易被读成断言数——建议下轮统一口径。
4. **5 栈非单 lane（B 轨语义待重裁）**：报告与收口件均已申报，`91f5b173` 的 5-parent 工作区合并实测印证工作区实为多栈，`but land --whole-stack` 只收单栈的判断与实测一致。此为**待owner 裁量的开放项**，非子 Agent 越权。
5. **审计方自身失误（如实呈报）**：首轮我并发跑了 `turbo test` 与 `ship-gate`（后者内部亦跑 test），两套全量测试争抢资源导致一批**假失败**（两次失败集不一致）；又用裸 `node` 直跑 `.ts` 测试文件，误报 codebuddy/cursor 失败。两者均为**审计方法错误**，非被审对象缺陷。已按「重跑第 1 条同一套验收」纪律自纠，结论以修正后证据为准（test 13/13、ship-gate exit 0、codebuddy 18/0）。

---

## 5. 结论与处置建议（审计窗不修，等owner 裁定）

**验收结论：R97 正题 A（自造失效声明可机检类别）实现闭环成立，硬验收零虚报；但「D-001~D-006 全覆盖」应降格为「T1~T6 主干覆盖，T0/T7 有账本偏离，T3/T6 有装饰化弱化」。**

按职责分离，以下问题**不在审计窗动手**，呈报owner 裁定：

- **建议打回原修复窗口返工**（附修复要求）：P-1 交付件失准、P-6 ratchet 装饰、P-2 清算义务机检、S-1 假绿方向、S-2 豁免补断言、P-8/P-9 双源与 reuse 无保障。
  **返工后必须重跑第 1 条同一套验收**：check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0` + green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126。
- **待 owner 批准后修**：P-7（N5 放宽后误降级 fail-open）、P-3（形态二 PENDING 挂接）、P-5（CHANGELOG 分行）、P-4（land 先行时序）、P-10（两速扫真正分权）、§4-3（断言口径）。
- **明确无需修**：报告已如实申报的 B 轨未执行、收口件双声明 land/push 后失效（纪律正确，当前自洽）、5 栈待重裁。

---

## 6. 审计方法学留痕（本轮可信度基础）

- 「不信报告自述」：15 条硬声明逐条亲自重跑或实物抽查，无一条采信自述。
---

## 7. 时态追述（2026-10-03 push 后追加，不改写上文历史证据）

owner 于审计通过后授权 push。`but push r97-selfcheckable` → `origin/r97-selfcheckable` = `a6c22612`（new branch，实测）。

**上文 §1 第 10 行、§4 第 2 条所述「ref 缺位 / 未 push」是审计时点的事实快照，现已过时**——保留原文以保全证据链，另在此追述当前态：

| 声明位置 | 审计时点 | push 后当前态 | 处置 |
|---|---|---|---|
| 收口件文首标记 | `state: unpushed r97-selfcheckable` | 失效（ref 已存在） | 已按重锚仪式改述为 `state: unlanded stack` + re-anchor 注记（理由+审计+reauthored=1） |
| 收口件 run URL 段 | `PENDING: stack-unpushed` | 失效 | 已改述为 `PENDING: pushed-no-branch-runs`（ref 存在 ∧ `on.push` 仅覆盖 `main`，特性分支物理无 run） |
| 本审计交接件标记 | `state: unpushed r97-selfcheckable` | 失效 | 同步改述为 `state: unlanded stack` |

**当前谓词实测为真**：`unlanded` 谓词 = `git rev-list origin/main..origin/r97-selfcheckable` 非空 → 实测 **36** commits，非空，故为真。

**本轮自证**：这是「自造失效声明」同族缺陷的**第四次真实复现**（R95 F5R push 自造失效 / R96 P5→LOOP2 F1 / R96 §10.3 改写打断机械锚 / 本次 push 使两处声明同时失效）。前三次由人工审计抓到，本次与 R96 LOOP3 同型——**push 后立即按仪式改述，不静默留旧**。R97 立法门禁（形态一状态腿）本次未参与判定（改述由人工按仪式执行），但其词表 `unpushed`/`unlanded` 正是本次改述所依据的封闭枚举。
- 「子 Agent 结论亦须复核」：Standards/Spec 两份子 Agent 报告的每条 HARD/JUDGEMENT 均由审计 Agent 用 `rg`/文件读取二次确认；两条一度存疑的（codebuddy 17/1、cursor 报错）经查为**审计方调用姿势错误**，已修正并撤回对被审对象的指控。
- 证据可复现：`.scratch/audit-r97/{check,build,test2,gate2}.log`。