<!-- state: unlanded r98-grill-ledger @ 2026-10-03 -->
# Handoff — Grill Round 98 任务书（自造机检声明第五形态 + R97 返工前置轨 + 全栈清算执行）

- 日期：2026-10-03 | slug：`grill-round-98`
- **唯一事实源**：`.scratch/grill-round-98/decision-ledger.md`（D-001~D-004 全 current）
- 上轮交接：`.scratch/grill-round-97/handoffs/next-round.md`（R98 任务书原件=本任务的来源处⽅）
- R97 审计报告：`.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（返工票 R1~R10 与降级证据）

## §0 执行纪律

- 全部 VC 操作走 GitButler；`but land`/`but push` 已获 owner 授权（限 D-001(c) 登记的序列与窗），范围外不扩权。
- 判定核保持纯净：禁 `spawnSync`/`fs`/`Date.now`/`process.env`，时钟 `env.now`、注册表 `env.registry` 注入。
- 薄壳只采集/委托/退出，不写判定 if；正反成对 fixture 必备；零测试=失败；fail-closed，未列谓词/锚→RED，环境不可用→env-PENDING 不静默过。
- 每票收口前自对账其覆盖 D 条的全部规范化需求；发现账本偏离须具名申报，不静默。

## T0 — goal 定锚 + B 轨逐栈 land（owner 授权窗）【覆盖 D-001(c)/D-004】

1. 写 `.scratch/grill-round-98/goal.md`：三轨名义（正题=第五形态立法 / 前置义务轨=返工 / B 轨=VC 清算）、范围外清单（见 §范围外）、风险登记三件（①首次真实 CI run 可能首红 ②ff-land 后 run-URL 仍只能 PENDING，GREEN 兑现待 PR 拓扑 ③land 绕过 review 检查，替代保证=审计电池+首次 CI run）。
2. 前置闸门必做：`node scripts/ship-gate.mjs` 复跑绿后才 land。
3. 逐栈 land 序列（每步后 `but pull` reconcile 余栈保 ff 性）：`but land r97-audit-reanchor --whole-stack`（37c，实现主车道，r95-rework 随栈合流由 but pull 回收）→ grill-docs 栈顶 `r98-grill-ledger`（含本账本+任务书）→ `r97-audit-ledger`(2c) → `r96-audit-loop2`(4c) → `r95-audit-loop2`(3c) → `r95-audit`(1c)。
4. 每次 land 使相关 `unlanded` 声明失效 → 按 R97 已立法重锚仪式改述（理由+审计+reauthored 计数）。
5. 观测 land 触发的首次真实 CI run（ci.yml/ship-gate.yml on.push main），结果入轮报。

## T1 — 前置义务轨：返工 R1~R8/R10【覆盖 D-001(b)】

先于一切新立法/新实现。顺序：方向性修复先行（R1 S-1 报告级全量扫对未采集分支出 GREEN→env-PENDING；R8 P-7 N5 放宽后误降级方向 fail-open→修正），随后 R3 P-8 裸词枚举单源化 / R4 P-9 reuse 指针机器保障 / R5 P-6 ratchet recount 比对+上表面 / R6 P-2 收口清算义务补码（栈空∨deferred 在册）/ R7 P-3 形态二 PENDING 位挂接 / R2 S-2 span·fence 豁免断言补网；R10 CHANGELOG 分行随 T4 簿记件。修完重跑同一套验收电池（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate REAL_GATE_EXIT=0+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126），**断言数只升不降**；R3/R4/R5 修复产物=首批锚中 3 锚的真实消费方（dogfooding）。

## T2 — 立法包【覆盖 D-002/D-003】

ADR-0099 单件：第五形态判据「ADR 宣称机器约束 ∧ 实现零消费 → RED」；锚注册表 schema `{锚ID, 宣称的机器约束, 消费方证伪 fixture 指针, 失效触发}`；两枚自指钉（无 fixture 不准入表 / fixture 未执行或未产出预期 RED→注册表自身 RED）；参数化注入；失效语义全程三元组；双红后果与开放面写进 Consequences/Known-Risks。CONTEXT 加「Grill Round 98 — Terms」区（~8 条）。锚注册表数据结构+首批证伪 fixture 骨架随立法同批。

## T3 — 检测器实现【覆盖 D-002/D-003】

判定核 `env.registry ?? 生产常量` 参数化；ship-gate 新增独立自检腿薄壳（壳执行各锚 fixture、核判 kill/no-kill；与 state 腿平级）；静态引用计数前检分流（永不独立出 RED）；ratchet 类挂封闭 PENDING 码进 deferred registry；5 锚首发各配证伪 fixture（失真注入→断言期望 RED）。

## T4 — 簿记【覆盖 D-004】

CHANGELOG r98 节按 feat/fix/docs 分行（=R10 合规自证）；deferred registry 两新票（ratchet-recount 升 RED 排程 / 开放面扩展示范）；既有 `no-pr`/`unpublished` deferred 沿账不动；ADR-0099 Consequences/Known-Risks 回填；ADR index 再生成。

## T5 — 收口【覆盖 D-004】

轮报 + closeout（claims 用 verbatim kind 自证）+ next-round.md 轮回覆写 R98→R99 + 三态骨架（全绿/降格/F-bug 承接）+ land 后声明重锚核验（收口清算义务「栈空∨deferred 在册」首次机检兑现=R6 验收场）。

## §范围外（显式负向清单，账本 D-001⑥ 原文沿用）

- 不重开评测矩阵修订、不动 r88 formally-declined、不追写已冻结 claims 工件、不做发布/tag。
- 活体谓词 `no-pr`/`unpublished` 仍只走 deferred 扩表示范票不实现；`docs/adr` 权威档不入状态标记靶位。
- 不裸删任何远端指针；通用死代码检测/ADR 文本自动发现/消费方登记契约/monkeypatch/复制源码双源均为已禁项。
- gitbutler 技能文档缺口回写（`but land`/`but absorb`/`but forge review` 未收录）=仓外 user 级文件，轮外 chore，须 owner 单独授权。

## suggested skills

- T0：`gitbutler`（land/pull/重锚）。T1：`tdd`（成对 fixture）+`diagnosing-bugs`（R1/R8 方向性缺陷）。
- T2/T3：`domain-modeling`（类别立法/词条区）+`to-spec`+`tdd`。T5：`handoff`、`neat-freak`。

## §工件索引

- 判定核 `scripts/handoff-lint-verdict.mjs` | 薄壳 `scripts/handoff-lint-shell.mjs` | 门禁 `scripts/ship-gate.mjs`
- 单测 `packages/store/test/handoff-lint-verdict.test.mjs` / `handoff-lint-e2e.test.mjs` | fixtures `packages/store/test/fixtures/handoff-lint/`
- ADR-0098（R97 立法）/ ADR-0097（含 errata）| 模板 `docs/agents/handoff-template.md` | registry `docs/deferred-registry.json`
- R98 账本 `.scratch/grill-round-98/decision-ledger.md` | 本任务书 `.scratch/grill-round-98/handoffs/next-round.md`
