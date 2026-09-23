# ADR-0080: Grill Round 79 — pathlint 豁免域契约收敛（三豁免域立法 + WORD_CHAR 边界修复）

## Status

Accepted (implementation round r79). Records the round-79 decisions per the
serial ticket plan T0–T2. Ledger:
`.scratch/grill-round-79/decision-ledger.md`
(D-001~D-004, 无断号). Evidence root:
`.scratch/grill-round-79/evidence/`.

## Context

R78 审计残账在 pathlint 判定器域暴露同一份契约漂移的两个面：(i)
`hitViolation` 仅在 `!fenceMarked && !isLocator` 时调用——covered-fence 与
`Stack:` locator 行内 in-repo 检查整段跳过，实现早已豁免而 ADR-0072 文本
未开列（「markers 不豁免 in-repo」字面与实现张力）；(ii) `detectSurfacedSkips`
先于 fence/locator 判定产出 → `/x` surfaced-skip 在 transcript 摘录内产
info 噪音。同域第三件：WORD_CHAR 缺 `_` 致 `foo_C:\x` 形标识符粘连盘符
误报（R78 P-6 残账）。三块同契约域 → 单轮收敛（D-001）。

## Decision

### D1 豁免域契约 Codify——三豁免面显式立法（D-002）

- (i) **covered fence**：合法 `machine-local` marker 紧贴 fence 前行 → 块内
  **全部检查**豁免——transcript 摘录必须逐字，改写路径即销毁证据保真；
- (ii) **locator line**：`Stack:` 类行可携 in-repo 绝对路径——locator 语义
  =指位而非指目标，仓根并不总能 repo-relative 表达；
- (iii) **`/x` surfaced-skip**：所有 fence（覆盖与否）+locator 行静默——
  info 是散文面信号，非摘录内容。

非豁免近邻保持执法：unmarked fence 内 in-repo 与非 locator 散文 in-repo
仍违例；散文 `/x` 仍产 info；裸 `C:\x` 仍拦，标识符粘连 `foo_C:\x` 非命中（WORD_CHAR 含 `_`）。 <!-- machine-local: 判定器边界用例字面量（裸盘符散文引用） @ 2026-09-23 -->

实现侧：`detectSurfacedSkips` 产出移序至 fence `continue` 与 locator 判定
之后（c1）；`WORD_CHAR` 补 `_`（c2）。ADR-0072 D1 增补 amendment 段；
AGENTS.md「Deliverable path discipline」镜像同步；镜像一致性由
`ship-gate-pathlint.test.mjs` 关键词双载体断言机械钉死。

### D2 drift 归因——文本侧未审视，实现侧有意图（D-002）

IaC attribution 判据：三豁免域的实现侧行为各有正当理由（transcript 保真、
locator 指位语义、仓根不可相对化），文本侧「markers 不豁免 in-repo」是写
文档时未审视实现的笼统字面——drift 归因在文本侧，故 Codify 而非 Revert。

### D3 Rejected alternatives

- **Revert（实现向文本收敛）**：恢复 fence/locator 内 in-repo 执法——否决：
  破坏 transcript 证据保真（covered-fence 语义=逐字摘录，改写路径即销毁
  证据），且与真实 `Stack:` locator 用例冲突（仓根绝对路径无法全部
  repo-relative 表达）。
- **逐面混裁（per-surface 分开裁决）**：三豁免面各立一题——否决：立法负担
  相当但内聚性更差（同一豁免域契约问题的三面，拆开各自成题=稀释）。

### D4 豁免域扩大风险披露 + 三重缓解

风险：豁免域是执法盲区，扩列即扩盲区。三重缓解：(i) 一致性测试钉死——
近邻成对 fixture（每豁免断言携一线之差非豁免对照，防 mutation 绿色假象）；
(ii) stale-marker 棘轮为 fail 级护栏（marker 行不再命中即报 stale-marker，
标记只减不增）；(iii) 季度审计注册——open declarations 按 AGENTS.md 既有
「audited quarterly」节律续审。

### D5 先例层级标注

结构性同构先例：markdownlint disable→fence→restore 段豁免、gitleaks 受审
artifact 声明、NIST tailoring 显式开列边界——结构同构非规则级相同；本仓
细则（in-repo 不豁免/棘轮/info 面分层）为自有立法，不冒充既有规则。

### D6 不 bump 判定

治理工具链契约收敛：判定器行为收敛不改变立法对象（ADR-0072 三分类不变），
无发布态代码增量 → 版本不 bump。

## Consequences

- `/x` surfaced-skip 现为散文面信号：所有 fence（覆盖与否）+locator 行
  静默；散文 `/x` 仍产 info。
- covered-fence 内全部检查跳过、locator 行 in-repo 放行自此为显式立法
  契约而非实现巧合；`foo_C:\x` 形标识符粘连不再误报。
- 文书面次生效应实录：WORD_CHAR 修复使 r78/r79 文书内 5 个仅靠该 FP 撑活
  的 marker 翻转为 stale-marker，同票清剿（棘轮按设计生效——FP 修复暴露
  真实死 marker）；任务书/调研存档内裸 `C:\x` 字面量行补 marker。 <!-- machine-local: 判定器边界用例字面量（裸盘符散文引用） @ 2026-09-23 -->
- T0 ride-along：dsh 0.1.7-alpha.2 观测取证归档，零行动项（alpha 线稳定锚
  不响→非 L2 候选）；E6 lockfile 龄期闸执法空白显式注册为 R80 候选
  （defer-r79-lockfile-agegate-replay）。
