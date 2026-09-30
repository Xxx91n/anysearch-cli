# Round 91 收口 — dsh 售后验收轮（dsh-l3-smoke-closeout）

Stack: r91-agy stacked above r91-grill（GitButler lanes，未 land）→ main @ 49766cab

## 绿色 run URL（祖先线实证）

- main tip 49766cab CI 三跑全绿实证（当日本地分支基底）：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782541 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782344 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782634 success
- 祖先 846b2eb6（R88 同批）备录：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337984 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337659 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337504 success
- 本轮提交未外发（无 push/publish/tag——纪律内）；本地门禁终态见 reports/2026-09-29-report.md

## 票序终态

| 票 | commit (sha + but-id) | 结果 | 实证索引 |
|---|---|---|---|
| T0 哨戒+宿主备版 | f40f227b (kmv) chore | ✅ | dist-tags 快照（next=0.2.0-rc.2/latest=0.1.7-rc.2 无 stable→TC 不启）+ dsh 本机升级 0.1.7-rc.2 + 基线 check/test/ship-gate 三份证据 |
| T1 判据立法 | b74fe057 (wpr) docs | ✅ | ADR-0092 判据立法（门三腿/三分支判词/词汇锁定/WORKFLOW 判死/readme-token claims 立法）+ adr/index 0092 行 |
| T1 取证通道探针 | a5ec8eeb (ssl) chore | ✅ | stream-json 通道机制 ESTABLISHED；model-request 端点直达实证；T2 准入通过 |
| T2 L3 冒烟执行 | 5b6a397f (otk) chore | ⚠️ F-bug (分支 C) | L3a established (dump-config 单行在架)；L3b/L3c 因 DEEPSEEK_API_KEY 环境缺失 not-established；双工件落盘 |
| T3 README 对齐 | — docs | ⏭ 条件未达未启 | 判词为 F-bug (< 降格档)，依条件票纯度守则：未启不留痕（README 维持现状） |
| T4a ship-gate 修复 | fcf97e32 (lvx) fix | ✅ | `scripts/ship-gate.mjs` 正则修复：`/id:s*mcp-anysearch/` -> `/id:\s*mcp-anysearch/` 独票修复，双选言验证均活 |
| T4b/c 顺验与证据 | 144015a2 (ppu) chore | ✅ | T4b 弃用文案双空格枚举备准与 E401 执行态如实记账 + T4c approval-channel headless 可行性探测证据档 |
| T4d WORKFLOW 判死 | 随 T1 (b74fe057) 落地 | ✅ | D3 判死立法随 T1 落地，票序节由 T5 补记；D-003 四件实落三 commit (T4a 独票, T4b+c 合票, T4d 随 T1) |
| T5 收口件批 | 本批 (uts) docs | ✅ | ADR-0092 完成体 + CONTEXT 7 词引用锚补齐 + registry 更态 + closeout-claims 8 项 + 轮报 + 终态戳 + CHANGELOG |
| T6 门禁复核 | — | ✅ | pnpm -r check exit 0 / pnpm -r test exit 0 / ship-gate --quick [pass]×65 [fail]×0 全闭环 |
| TC 条件票 | — | ⏭ 未触发 | T0 观测无 0.2.0 stable 晋升，一次定死不启 |

注：but-id 列（kmv/wpr/ssl/otk/lvx/ppu/uts）为唯一稳定锚；文内 sha 均为**落笔时值**——每次 amend 后即失效，不可作为可核锚点；land 后以 main `git log` 为准。

## 已核验的关键事实

- 宿主升级：`@deepseek-ai/dsh` 升至 `0.1.7-rc.2`（测=记=钉三版收敛）。
- 装册绿成立：`dsh plugin --profile headless list` 确认 `@anysearch-cli/dsh-plugin@0.1.0` 在位；`dsh --profile headless --dump-config` 可见 `id: anysearch-dsh-plugin`。
- 取证通道机制成立：`dsh --profile headless --json` 验证输出标准 NDJSON 事件流；第二探针带 dummy key 证实 model-request 直达 DeepSeek 官方 API 端点。
- 判词客观诚实：因环境未提供 `DEEPSEEK_API_KEY`，L3b tools 载荷无法观测，如实出具 F-bug 判词，锁定 T3 条件票。
- 治理修补完备：`ship-gate.mjs` 正则反斜杠修复；`npm deprecate` 双空格枚举备准与 E401 权限如实记账；`approval-channel` 证实 headless 缺少 answerer 维持 defer；`WORKFLOW.md` 终审判死并封口审计；8 项 closeout-claims 全绿。

## 挂账（下轮/观察项）

1. `DEEPSEEK_API_KEY` 凭证提供后复跑 T2 诱导 turns。
2. `readme-token-pin` 断言检查器接入（R92 候选票）。
3. `defer-r72-dsh-approval-channel` 维持 open 挂账。
4. `npm deprecate` 待用户具备写入权限账号亲触执行。
