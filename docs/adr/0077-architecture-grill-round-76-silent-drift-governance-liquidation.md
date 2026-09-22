# ADR-0077: Grill Round 76 — 治理面静默漂移清算（closeout 覆盖断言 + governed-JSON canonical 锁）

## Status

Accepted (implementation round r76). Records the round-76 decisions per the
serial ticket plan T0–T2. Ledger:
`.scratch/grill-round-76/decision-ledger.md` (D-001~D-005, 无断号).
Evidence root: `.scratch/grill-round-76/evidence/`.

## Context

两件同构失效模——治理机器自己的 silent-drift（治理面反被静默漂移咬）：

1. `defer-r71-shipgate-1g-coverage`（R70 F1 原形，已四轮）：ship-gate step 1g
   leg-b 的 fallback 挑「最新含 closeout 的 round dir」即 break——最新 round
   无 closeout 时静默回退到旧 round 报绿，缺失产物被吞掉且不留痕。
2. `docs/deferred-registry.json` 格式漂移：外部进程/编辑工具两次整文件重排
   （1→8、1→4 空格），每轮人工恢复最小 diff——受治理文件的 byte 形态游离于
   断言之外。

## Decision

### D1 完成信号 = ADR index 登记（ledger D-002）

「round 已完成」的确定性信号 = `docs/adr/index.md` 中存在 `Grill Round N`
登记条目（ADR 落盘 = round 收口完成；主流 registry 路线——changelog-enforcer
A/M 判定、ao-kernel SSOT validator、ADR 生态 index 惯例同构）。不读目录存在
（存在≠完成）、不读 git 态（GitButler 虚拟 workspace commit 耦合）。
**登记即完成纪律**：ADR 条目不得先于 closeout 登记——先产物后登记，倒置即
瞬态红；报错文案引导「补 closeout 或移除登记」。

### D2 fail-closed 三断言 + 显式豁免（ledger D-002）

leg-b 重写为 `scripts/closeout-coverage.mjs` 推导 + `assessCloseoutCoverage`
三断言，全部 fail-closed（「nothing to check」=失败而非通过）：

- **(a)** 已登记 ∧ N≥floor 的 `.scratch/grill-round-N/` 无 closeout → 红；
- **(b)** index 登记集合 ↔ .scratch/ 已完成 dir 双向不一致 → 红（单向信源
  解析漂移本身就是新的静默失效面，必须互验）；
- **(c)** 推导的 round 集合为空或不可解析 → 红（解析器对未知行形状
  fail-loud 不 skip——PlayMolecule 假 COMPLETED 判例：空推导必须 fail 向
  「未完成」侧）。

在飞豁免显式化：最新 dir 未登记 ADR → 打印结构化豁免行
`awaiting closeout: round N (ADR not yet registered)`（report skip 档，有
载体、有理由、可观测），不许隐式 break。成功输出打印 round 覆盖计数
（registered/completed at floor N）——assert-the-count 教义：让下一次静默
缩减变成读者会注意的东西。leg-b 字段 lint 面不动：仍只 lint 最新含
closeout 的 dir（控 gh liveness 成本）。

返工加固（r76-audit 复审核销）：closeout 判定锚定命名惯例
`round-NN-*closeout*.md`——`release-closure`/`disclosure`/`enclosure`
类仅含 "closure" 的文件不再计入 hasCloseout（F-2：`release-closure`
冒充 round closeout 恰是本 ADR 要杀的静默掩盖形态，round-63 实物文件
作回归用例）；豁免行先于 violation `fail()` 打印，混合红态下仍可观测
（F-3）；scoped 空集——floor 以上既无登记也无 round dir——显式判红，
「nothing to check」不留 vacuous green 出口（F-4）。二批小修（backlog
顺手核销）：titleRound 须匹配 `Grill Round N —` 惯例（N 后跟破折号），
非 round ADR 标题句中提及不登记；`grill-round-<非数字>` dir 不再被
regex 静默滤除，显式判红；coverage 违例先打印 [fail] 再 defer-exit 到
字段 lint 之后，coverage 红与 lint 红互不压对方诊断；index parser 与
gen-adr-index render 措辞解耦（非 `|` 行结构性跳过，row 形态仍
fail-loud）。

### D3 floor=76 规则生日锚定（ledger D-002）

`CLOSEOUT_COVERAGE_FLOOR = 76`（`scripts/closeout-coverage.mjs`）。ratchet
生态的「首个连续合规点」语义是「值可以旧」，存在性断言没有 baseline 文件
可挂也没有廉价伪造面——floor 锚定到规则生日（本 ADR 落地轮）：floor 前
缺失不追溯（不翻祖父旧账），floor 后已登记完成的 round 必须有 closeout。
ratchet 腐坏防护：floor 值写入本 ADR、日后调整走显式 review，不许脚本随手
改、不许隐式推导。

### D4 governed-JSON canonical 字节锁（ledger D-003）

ship-gate step 1 内新增 `stepGovernedJsonCanonical()`（不开新编号腿）：对
硬编码常量 `CANONICAL_JSON_FILES = ["docs/deferred-registry.json"]`（n=1）
逐文件断言字节全等——文件字节 ≡
`Buffer.from(JSON.stringify(JSON.parse(src), null, 1) + "\\n")`。
**字节级而非语义级**：deep-equal 会漏报重排缩进，恰是两次事故的形态；
verify-don't-regenerate（alint `generated_file_fresh` / `go generate` CI
惯例的最小特化，纯函数无 spawn）。报错 UX：JSON 非法先报独立
`not valid JSON`；合法但字节不匹配报 `first differs at line N` + 一条可
粘贴 `node -e` normalize 指令 + 清单常量所在脚本位置（防清单腐化无人知）。

### D5 键序语义 + 不自修 + 翻案条件（ledger D-003）

- **键序**：canonical = V8 原生 `JSON.stringify` 输出序（integer-like 升序
  +字符串插入序），禁 replacer/排序序列化——排序序列化会让 normalize 静默
  改写键序。键序被外部重排成 canonical 形态属残余风险，接受（已两次事故的
  形态是整文件重排，不在此面）。
- **不自修**：gate 只报错附指令不改写——「提交内容≠审阅内容」反模式
  （jyn.dev/Lobsters）；formatter 分工惯例 `--write` 归人 `--check` 归 CI。
- **自文档**：registry 顶层 `note` 字段写入锁定声明（含 normalize 指令），
  一次定稿成为 canonical 一部分——防新人/agent 把 1 空格当损坏去「修」。
- **翻案条件**（不写死）：清单扩到 n≥5 且含 md/ts 多类型、团队要全仓统一
  格式化时迁注册制 config 并引 prettier，把 canonical 重定义为 prettier
  输出（断言改 `prettier --check`——检查腿与 formatter 天然可互换）。
  否决留痕：不动 .gitattributes（传输展示层，对内容字节零防御）；不走 hook
  路线（GitButler #5735 pre-commit 绕过 staging area 静默不执行、#12748
  `but setup` 覆盖 hook 管理器——CI rejection is the final guard）；不引
  JSONC/JSON5（破坏 `JSON.parse` 纯净性，注释需求走 `note` 数据字段惯例）。

### D6 发布判定：不 bump（ledger D-004）

本轮改动全部落在 repo 工具链/治理文书面（scripts/*、docs/*、test/*、
.scratch/*），无发布态代码增量（packages/apps 无 src 变更）→ 不 bump 版本，
显式记录此判定而非默认跳过。

## Consequences

- step 1g 从「fallback 挑旧产物报绿」变为「登记信号 + 三断言」：最新 round
  缺 closeout 即在登记当轮爆红，不再静默回退；在飞轮打印豁免行可观测。
- `docs/deferred-registry.json` 此后每次编辑都被字节锁验证 canonical；
  外部工具再整文件重排 = ship-gate step 1 即红 + 一键 normalize。
- 新模块 `scripts/governed-json.mjs` / `scripts/closeout-coverage.mjs` 走
  既有惯例（纯逻辑出模块 + `packages/store/test/*.test.mjs` 行使），
  known-bad fixture 在 turbo test 闭环内常态化红绿双证。
- floor=76 起算：r62–r75 目录存量不追溯（规则生日前无义务）；登记面与实际
  落盘面自本轮起锁步。

## Closure evidence (ledger D-005 三段)

- **(i) 锁段**：`stepGovernedJsonCanonical` 落地 + 双向行使实证——注入
  8 空格重排 → `[fail] canonical-json: ... first differs at line 2 ...
  normalize: node -e ...`（`evidence/t0-canonical-inject.log`，临时 commit
  `nvx` 行使后 discard）；normalize 指令亲跑恢复 15065B canonical；
  registry `note` 锁定声明落盘；此后每次 registry 编辑过闸（T2 续债条编辑
  即受锁验证）。
- **(ii) 1g 段**：三断言全行使——(a) 登记后无 closeout 真红（登记先行
  commit 态实测）、(b) 未登记 closeout 注入真红（fixture commit 注入
  round-77 closeout 实测）、(c) 空推导/不可解析在模块层行使（真 gate 结构
  上被 1b regenerate-and-diff 先行拦截，见报告诚实注记）；豁免行实测可见
  （`evidence/t1-inflight-exemption.log`：`awaiting closeout: round 76
  (ADR not yet registered)`）；成功输出带计数 `N registered / M completed
  at floor 76`；字段 lint 面不回归（仍 lint 最新含 closeout dir）。
- **(iii) 文书段**：本 ADR + `gen-adr-index` regen（77 条）+ registry 收口
  （`defer-r71-shipgate-1g-coverage` 核销 closed、格式锁立项事实入档、
  落选债 11 条显式续债条）+ CONTEXT.md 实现期新词核验 + CHANGELOG
  Unreleased 条目 + handoff（#1764 观察哨续挂 + 外发闸待用户发回录）+
  pathlint 自证（round-76 文档全在已登记 doc dirs）+ ship-gate 全绿 +
  `turbo check`/`test` 绿 + `but` commit 干净。

## Research sources

`.scratch/grill-round-76/q2-atomcode.md`（15 条：aiArch《Validating the
Validator》、GitHub required-checks pending 先例、changelog-enforcer、
ao-kernel、ratchet 生态、madr-lint、adr-kit 等）与
`.scratch/grill-round-76/q3-atomcode.md`（alint generated_file_fresh、
prettier --check 设计、sqlc/go generate 惯例、GitButler #5735/#12748、
jyn.dev/Lobsters hook 共识、MDN 键序语义等）——两份调研存档为 D2–D5 的
教义+先例来源，票内不另开新调研（atomcode 串行配额纪律）。
