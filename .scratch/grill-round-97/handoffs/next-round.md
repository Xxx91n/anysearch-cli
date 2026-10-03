# Handoff — Grill Round 97 任务书（自造失效声明可机检类别 + 全栈清算）

- 日期：2026-10-03 | slug：`grill-round-97`
- 唯一事实源：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006 全 current）
- 上轮权威交接：`.scratch/grill-round-96/handoffs/round-96-audit-loop3-handoff.md`

## §0 执行纪律

- 数据源唯一=账本；禁止从对话回忆补充结论，发现账本缺项→停下呈报不补写。
- 版本控制全走 GitButler；`but land`/`but push` 属授权动作——T0 是 owner 授权窗，未授权不执行。
- 判定核纪律沿用：`scripts/handoff-lint-verdict.mjs` 纯模块（禁 spawnSync/fs/Date.now()/process.env），`ship-gate.mjs` 薄壳只做采→传→出口；fixture 允许+拒绝成对（OPA）；测试数为零=失败。
- 立法先于断言（T1 条文先行）；fail-closed；词表外谓词=RED；环境不可用=env-PENDING 不静默过。
- 每票完成后按账本对账：票尾核「本条 D 记录的全部规范化需求是否都有落点」。

## §1 任务表（T0→T7）

### T0 — 开工锚点 + B 轨全栈清算执行窗 【覆盖 D-001, D-002】

- 写 `.scratch/grill-round-97/goal.md`：正题=自造失效声明可机检类别；范围外清单抄 §2。
- owner 授权后按序执行（先于一切 R97 实现 commit）：
  1. `but land r96-audit-loop2 --whole-stack`（默认 ff 形态）；
  2. 核验 `origin/main` 推进（`git log origin/main -1` / `git ls-remote origin main`）；
  3. `but pull` 回收已合流分支标签——`r95-rework` 预期随此自动消失；残留→留置（(a) 兜底），不裸删远端指针。
- 可选 land 前置闸门：`node scripts/ship-gate.mjs` 本地复跑。
- 观察义务：push→main 首次触发 `ci.yml`/`ship-gate.yml` 真实 run——R96 GREEN 路径首演场。已知边界（记 ADR-0098 Known-Risk）：ff-land 后 `origin/main..origin/<branch>` 为空，栈内 commit 集为空→land 后轮产物的 run-URL 字段仍只能 PENDING；GREEN 真兑现待 PR 拓扑。

### T1 — 立法包（先行于实现票） 【覆盖 D-003, D-004】

- `docs/adr/0098-*.md` 决策条文初版：类别三元组 `{词表项, 机械核验谓词, 失效触发谓词}` + 封闭注册表（扩表须改门禁代码；扩表 PR 自身受门禁约束）+ 词表初版三项 + 生效域边界（新声明自立法日起过机检；存量=流程豁免）+ 形态二内容规则（实测值须挂复现命令/marker；机检腿先 PENDING 位）+ 已知 `count` 锚同数换位盲区记项。
- `CONTEXT.md` 「Grill Round 97 — Terms (ADR-0098)」词条区一次落：自造失效声明 / 谓词注册表 / 状态标记 / 失效触发谓词 / 裸词违例规则 / verbatim 锚 / 重锚仪式 / 锚覆盖缺口 / 两速扫分权 / 收口清算义务。
- `handoff-lint-verdict.mjs` 增注册表常量：每词表项 `{核验谓词, 失效触发, 环境需求, reuse 指针}`。
- `packages/store/test/fixtures/handoff-lint/` 首批成对用例（每词表项 allowed+denied；语法违例/词表外谓词/裸词违例各配用例）。

### T2 — 形态一实现 【覆盖 D-003, D-004】

- 标记解析器：`<!-- state: <predicate> <args> @ <iso-date> -->` 单行 HTML 注释；单条正则整体可解析；args 禁 `--`；`stack` 占位=解析 Stack 行具名分支。
- 裸词违例扫描：词表英文 token+登记的中文等价短语封闭枚举（字面匹配非 NLP）；代码 span/fence 豁免；散文从属于标记禁反向。
- 三项离线谓词：`unpushed`（`origin/<branch>` ref 缺位）/ `unlanded`（`git rev-list origin/main..origin/<branch>` 非空）/ `no-branch-runs`（workflows `on:` 触发器无分支覆盖；注册表条目记 reuse 指针，触发器实现变更走扩表流程）。
- 判定集成：声明-事实冲突→`declaration-fact-conflict`；词表外谓词→RED；核验环境不可用→env-PENDING；失效触发求值（声明须写入时真且运行时仍真）。
- 靶位：最新含 closeout 轮目录自移；无靶位显式 no-op+日志；靶位解析 golden 测试；报告级全量扫与门禁级增量扫分权（报告级只出报告不开门禁）。

### T3 — 形态三实现 【覆盖 D-003】

- claims schema 新增 `verbatim` kind：整句字节级锚（防同数换位/语义弱化盲区）。
- 重锚仪式：改写须携变更理由+落审计记录+ratchet 可见的重批计数——verbatim 不脱离仪式单独立法。
- R97 `closeout-claims.json` 首批用 verbatim 锚自证（dogfooding）。

### T4 — N5 修法三件 【覆盖 D-005】（可拆 fix+docs 两 commit）

- `parseButStatusIds` 标记类放宽为「单个非空白非制表符号」（上游无官方枚举文档=放宽是诚实解）；未知标记显式行为=整体解析降级，不逐行吞掉。
- E2E 冻结样本系统性补全 `●`/`◉`/`◐` glyph 集（系统性扫输入空间非个案补丁）。
- ADR-0097 Known-Risk 1 errata：原条目内注记+日期（预测 env-PENDING→实测逐行丢行硬 RED），不 supersede。

### T5 — 模板升级 + 形态二规则落档 【覆盖 D-003, D-004】

- `docs/agents/handoff-template.md`：状态声明位迁入标记语法（语法家；run-URL `PENDING{code}` 为先例形态）。
- ADR-0098 写入形态二内容规则全文（文档类/实测值定义/marker 语法；机检腿 PENDING 位挂接与 ratchet→RED 排程引用）。

### T6 — 簿记收尾 【覆盖 D-002, D-006】

- `CHANGELOG.md` r97 节：feat（形态一/三）+ fix（N5）+ docs（errata）分行。
- `docs/deferred-registry.json` 登记：①形态二 ratchet→RED 排程票；②扩表示范票 `no-pr`/`unpublished`（首张扩表=「扩表须改门禁代码」闭环验收场景）。
- 收口清算义务条款落地：轮收口检查清单机械条目「栈空 ∨ deferred 在册」（一句话条款，不配细则）。
- ADR-0098 Consequences/Known-Risks 回填（GREEN 兑现边界 / 活体谓词 flaky 记项 / count 锚盲区）。

### T7 — 轮报 + 收口交接 【覆盖 D-006】

- round report + audit 交接（三态骨架预写：全绿/降格/F-bug 承接表）。
- 写完 `.scratch/grill-round-97/handoffs/next-round.md` 的轮回版（R97→R98 交接）。

## §2 范围外（显式负向清单）

- 不重开评测矩阵修订（vert-f1105 家族不外溢）、不动 r88 formally-declined、不追写 <R97 已冻结 claims、不做发布/tag。
- 活体谓词 `no-pr`/`unpublished` 仅登记扩表示范票，不实现。
- `docs/adr` 权威档不入状态标记 lint 靶位（形态二地盘，防双重管辖）。
- `r95-rework` 不裸删远端指针。
- gitbutler 技能文档缺口回写（`but land`/`but absorb`/`but forge review` 未收录）=仓外 user 级文件，轮外 chore，须 owner 单独授权。

## §3 suggested skills

- T0：`gitbutler`（but land/pull/resolve）。
- T1–T3：`domain-modeling`（词条立法）、`tdd`（成对 fixture）。
- T4：`diagnosing-bugs` + `gitbutler`。
- T5：`domain-modeling`。
- T6–T7：`handoff`、`neat-freak`（残留盘点+分类）。
- 全期：`atomcode-research`（遇新裁量先深调）、`grill-with-docs`（纪律母本）。

## §4 工件索引

- 账本：`.scratch/grill-round-97/decision-ledger.md`
- 上轮交接：`.scratch/grill-round-96/handoffs/round-96-audit-loop3-handoff.md`
- 判定核：`scripts/handoff-lint-verdict.mjs` | 单测：`packages/store/test/handoff-lint-verdict.test.mjs` | fixtures：`packages/store/test/fixtures/handoff-lint/`
- 模板：`docs/agents/handoff-template.md` | 门禁壳：`scripts/ship-gate.mjs` | registry：`docs/deferred-registry.json`
- ADR 邻件：`docs/adr/0097-*.md`（errata 靶）/ 新立：`docs/adr/0098-*.md`（T1 起草）
