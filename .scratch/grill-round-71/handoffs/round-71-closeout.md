# Round-71 Closeout Handoff — 上架首航（0.0.6 首个双层门真发布）

Stack：分支 `r71-grill`（GitButler 栈），base `448b5f91`。轮内 4 提交（zxm 文书/yks T0/mmv T1/wno bump）经 `git branch -f main` 集成 main `d897707a`；`but pull` 并入上游后新栈提交 nlk（门禁修复）→ main `86fe753d`；release-bot 账本 `6c289397` = tag `v0.0.6`。分支隔离维持：r71-grill 不与其他栈互写。

## 绿色 run URL

- T0+T1+bump land `d897707a`：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35385334678 ｜ ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35385334689 ｜ native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/35385334671
- 门禁修复 land `86fe753d`：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473156 ｜ ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473167 ｜ native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473125
- 发布账本 sha `6c289397`（=v0.0.6）：自 dispatch ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35386551826 ｜ ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35386554103（required 全绿；macos-spillover-probe EXPERIMENT failure 门外不计）
- 发布三段：pre-tag#1 RED https://github.com/Xxx91n/anysearch-cli/actions/runs/35385345425（gate 缺陷实证）｜ pre-tag#2 GREEN https://github.com/Xxx91n/anysearch-cli/actions/runs/35386495456 ｜ post-tag assert+publish GREEN https://github.com/Xxx91n/anysearch-cli/actions/runs/35387286412

## 本轮落地（详见各锚点，不重复内容）

- 实施报告：`D:\Aworker\anysearch-cli\.scratch\grill-round-71\reports\2026-09-19-report.md`
- 裁决账本：`D:\Aworker\anysearch-cli\.scratch\grill-round-71\decision-ledger.md`（D-001~D-004 全落地）
- ADR：`D:\Aworker\anysearch-cli\docs\adr\0072-architecture-grill-round-71-first-release-path-governance-embedding-reachability.md`
- 证据根：`D:\Aworker\anysearch-cli\.scratch\grill-round-71\evidence\`——path-lint 红/绿 transcript 对、t1 双臂 spike 实录、t2 发布流实录、ship-gate t1/t2 绿 transcript
- 发布件：`@anysearch-cli/{cli,mcp,plugin,embedding}@0.0.6` registry 四包全量（npm view 实证），trusted publishing + sigstore provenance
- OF look：4（`114da320`）+5（`6c289397`）两次正业消耗均入 eval-looks.json，verdict warn+integrity pass

## 关键裁决与发现

- found 4 → fixed 4：devEngines 仓内告警源（源头删除而非发布面剥离）；pnpm 姊妹根断（sibling-root fallback）；transformers 未声明外部 onnxruntime-common（scoped _resolveFilename 别名）；release-gate GITHUB_TOKEN cascade 断（自 dispatch temp ref 修复）。
- 验证教训：CI 阶段从未跑过的门禁腿（pre-tag wait，R68 引入）首次真客即暴露结构性必死——双层门经实证后可用，但「经实证」三字是本轮新增的硬前提。
- 范围纪律维持：D-001 明示排除项（1g 缺口/macos 探针/provider 服务端/deferred 大池）零触碰。

## 下一个 grill 方向指示

1. **ship-gate 1g 门槛覆盖缺口**（R70 closeout 首推，本轮显式 deferred）。
2. **macos-spillover-probe EXPERIMENT 红因追查**（账本 sha 上仍 failure，门外件独立轮）。
3. **transformers 上游 undeclared-dep 跟进**：上游修复版本发布后移除 scoped patch（ADR-0072 挂起条件）。
4. 发布后小活：release-gate 自 dispatch 的 temp ref 生命周期（现 wait 后删——极端失败路径留 ref 可接受）；look 计数语义（重试消耗是否计入预算审计）。

## Suggested skills

- $grill / $to-spec / $to-tickets / $implement（下一轮常规流）
- $diagnosing-bugs（macos-spillover-probe 红因）
- $code-review（任何修复落地后复审）
- $handoff（下轮收口沿用本模板：Stack + 绿色 run URL + run-id 绑定本史）
