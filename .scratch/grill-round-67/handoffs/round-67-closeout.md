# R67 closeout handoff — 2026-09-17

接棒人下一轮（R68 或续跑）从这里开始。完整报告：`D:\Aworker\anysearch-cli\.scratch\grill-round-67\reports\2026-09-17-report.md`；审计交接：`D:\Aworker\anysearch-cli\.scratch\grill-round-67\handoffs\round-67-audit-closeout.md`；任务书：`D:\Aworker\anysearch-cli\.scratch\grill-round-67\handoffs\next-round.md`。

## 一句话状态

**R67 全闭环**：T1–T7 全部完成——Codex CLI 0.142.5 真宿主契约对齐已落地，`v0.0.5` 经 OIDC trusted publishing 发布（四包 latest=0.0.5 + SLSA v1 provenance + 净机冒烟全过）。

## 已完成的票

- **T1 真宿主裁决**（base `1dbcf63`，published 0.0.4 @ codex 0.142.5）：旧 `{name,command,args}` hooks 配置注册零钩；裸 `additionalContext` ~80% 丢；裸 `permissionDecision` 不拦；exit2 不拦；`hook_event_name` 为真实 stdin 字段；`required=true` MCP 硬退；matcher 全匹配语义；`-c` 不能表达 hooks。
- **T2 tarball 矩阵**：P1–P9 + CODEX_HOME 注入轨 + env 传递实证，全量在 `D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\`。
- **T3 修复**（commit `6faa3f8`，改前备份在 `D:\Aworker\anysearch-cli\.scratch\grill-round-67\backups\t3\`）：官方 hooks schema + `hookSpecificOutput` 信封化 + `permissionDecision` 透传 + `ans-hook-codex` bin + suffix-anchored matcher + `--envelope` SessionStart + 11 条契约测试。
- **T4 复验**：shipped 配置端到端 SessionStart 信封回显、URL deny 端到端拦阻（mcpCalls=0）、PostToolUse→index +19/+10 真实蒸馏行。
- **T5 文档**：ADR-0068、codex-integration.md、README verified-hosts Codex 行、CHANGELOG 0.0.5、CONTEXT/AGENTS 钉入。
- **T6 发布准备**：7 包 bump 0.0.5 + ship-gate 钉同步；ship-gate 净 clone 全绿。
- **审计+修复轮**：审计 PASS（F-01..F-06 经 `ebc22a8` 收口）；`but land` 双段落 main→`2cb2a8c`。
- **T7 发布**：pre-tag run `35211150217`（账本回写 `9a466b9`）→ `git tag v0.0.5`+push → tag run `35211259312` 全绿（gate 14s + publish 1m19s）→ 四包 registry live + 净机 `C:\Users\Administrator\AppData\Local\Temp\r67clean` 冒烟 → ADR-0068 Closure(iv)+报告/任务书回填（`2b9e6e8`）。

## 下一个 grill 方向指示（按建议优先级）

1. **契约族覆盖下一族：Cursor / Antigravity 真宿主验证**——R66 定谳 Claude Code、R67 定谳 Codex；cursor/antigravity 仍是裸契约未验面（R66 探针矩阵可三度移植，预期重判口径同 R67 D-003）。
2. **F-01a 工具链桶：ship-gate×GitButler clean-tree 双根问题 + step 8b `verify-observation` flake**——10s MCP timeout 在重负载步骤后偶发（单跑 3/3 PASS、闸内重跑绿；前科 `.scratch\grill-round-58\evidence\audit-r58-flaky.out`）；以及 `but land` 后 index 残留 staged 删除副产物（需 `git reset` 愈合，R67 已两次实遇）。
3. **deferred 池**（沿用）：provider 服务端排查、projectIndex 双库裁决、interactive TUI、embedding arm、跨 OS matrix、plugin 升格默认路径、watch 观测窗。
4. **观测项**：`query_knowledge` adapter=none stub 实装候选；OOD abstain=null 形状；PostToolUse ctx 同-turn 可靠性跨宿主基线；hooks trust `[hooks.state]` hash 生成路径 headless 实证。

## 关键事实（勿重查）

- Codex 0.142.5 契约（ADR-0068）：stdin `hook_event_name`（`event` 回退保留）；stdout 仅 `hookSpecificOutput` 信封有效；hooks 须官方 `{matcher,hooks:[{type,command,timeout}]}`；matcher 全匹配 regex；`-c` 不能表达 hooks；required=true MCP 硬退；hook 进程继承 codex env；PostToolUse 耐久行为=/index 副作用，同-turn 注入为宿主变量。
- 发布面：`v0.0.5` 已发（tag 在 `9a466b9`）；release.yml 双段=pre-tag dispatch 花 OF look+回写账本 → tag push assert+publish；npm 侧零 token（OIDC TP）；main HEAD=`2b9e6e8`。
- VC：`but` 无 tag 子命令（R66/R67 灰区口径：tag+push 用 git）；`but land` 直推 main 会绕 PR——已两次使用；r67-\* 分支已全部清除。
- e2e 现场在仓外 `D:\Aworker\e2e-r67-codex`（含未提交 token，勿入库）；净 gate clone `C:\Users\Administrator\AppData\Local\Temp\ansclean`。

## Suggested skills

- R68 grill 开门：`$grill-me` / `$to-questionnaire`（主题定界+账本，方向见上节）
- 审计窗口惯例：亲跑硬验收+声明→证据→结论对照+双轴 code-review，只出报告不动手修
