# Round-72 Closeout Handoff — DeepSeek Harness（dsh）宿主适配（verified-hosts 第 6 行）

Stack：分支 `r72-grill`（GitButler 栈，与 `r71-audit` 等栈并行互不写），base `c4ced36a`（main tip）。轮内提交：`uzt` grill定稿 → `tqq` T0 spike 九探针 → `yxo` T1/T2 实施+真宿主全桶验证 → `uyt` ADR index regen → `pxv` gitignore → `nnn` Stack 行 locator 修复 → 收口文档提交。未集成 main、未 push、未开 PR（GitButler 协议内交付）。

## 绿色 run URL

本轮为 GitButler 本地栈（无 push），CI run 引用既有本史祖先 run 作绑定基线：

- 上轮 land `86fe753d`（HEAD 祖先）：ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473167 ｜ ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473156 ｜ native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/35386473125
- 发布账本 `6c289397`（=v0.0.6，HEAD 祖先）：ship-gate 自 dispatch https://github.com/Xxx91n/anysearch-cli/actions/runs/35386554103
- 本轮本地门证：`node scripts/ship-gate.mjs --quick` 全绿（无 CI run——本地 transcript 入 `.ship-gate/report.json`），turbo check/test/build 手动全绿。

## 本轮落地（详见各锚点，不重复内容）

- 实施报告：`.scratch/grill-round-72/reports/2026-09-19-report.md`（D-004 四段对账 + found/fixed/deferred + 复跑指引）
- spike 报告：`.scratch/grill-round-72/reports/spike-report.md`（9 探针逐项 PASS + #8 blocking 通过 + Phase-2 GO）
- 裁决账本：`.scratch/grill-round-72/decision-ledger.md`（D-001~D-004）
- ADR：`docs/adr/0073-architecture-grill-round-72-deepseek-harness-host-adaptation.md`（index 73 条 regen）
- 新包：`apps/dsh-plugin`（@anysearch-cli/dsh-plugin 0.0.6 private 零运行时依赖 Cordis bundle，五面 hooks 全走 127.0.0.1:33333 IPC）
- 集成文档：`docs/deepseek-harness-integration.md`（Phase-1 手写行 + Phase-2 一步装 + loader 三律 + 升级 diff 指引）
- 证据根：`.scratch/grill-round-72/evidence/`——t0 四 boot transcript + wire 请求体 + zstd session 事件 + probe 包源码；t1 真 bundle e2e/IPC/wire 三 transcript；t2 幂等安装/dump-config 层/duplicate-insert boot 硬错/phase1 对照/双 server-down/tarball turn/web 复跑三 transcript + stub 源码 + webprobe-driver
- 门禁增量：ship-gate step 1s churn lint（红绿对已证）+ PKG_DIRS 第 8 包 + pathlint 239 docs + verified-hosts 双语第 6 行
- 文书：CONTEXT.md 两词块（loader 三律 / createRequire 桥）+ CHANGELOG r72 段 + deferred-registry +3

## 关键裁决与发现

- found 6 → fixed 6：createRequire ESM-CJS 混打、duplicate-insert 硬错、code-runtime 跨 bundle 撞名、Stack 粗体 locator 不匹配、noEmit 压声明、dsh-llm 缺 devDep——全部轮内闭环。
- 环境教训：本地自持 stub 占 33333 端口会污染 apps/plugin policy.test（kill 后 10/10 绿）——宿主探针与仓内单测的端口隔离纪律；Git Bash 下 `2>nul` 会建真 `nul` 文件弄挂 GitButler。
- 验证教训：churn lint 控件必须红绿对演示才可信（门内红态需干净树→临时 commit→undo 流程已走通）。

## 下一个 grill 方向指示

1. **dsh web 交互矩阵**（defer-r72-dsh-web-interactive-matrix）：浏览器驱动 turn + patchReload:live 现场热更 + approval 面——本轮具名两探针已过，交互面留 preview 轮。
2. **dsh-plugin 发布道**（defer-r72-dsh-plugin-npm-publish）：private→publish 一字段翻牌 + npm keyword dsh-plugin 自动入官方目录。
3. **ctx.tools 原生注册评估**（defer-r72-dsh-native-tools）：桥接层不足信号（ans_chat 长超时/结构化富返回）或上游 API 稳定时重启。
4. R71 续债不变：1g 覆盖缺口 / macos-spillover-probe / transformers 上游 / provider 服务端。

## Suggested skills

- $grill / $to-spec / $to-tickets / $implement（下一轮常规流）
- $diagnosing-bugs（dsh 升级 diff 异常或 web 交互红因）
- $code-review（任何修复落地后复审）
- $handoff（下轮收口沿用本模板：Stack + 绿色 run URL + run-id 绑定本史）
