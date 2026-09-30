# Round 92 收口 — Featherless 自定义上游 T2 复跑与售后收口轮（dsh-l3-smoke-featherless-closeout）

Stack: r92-grill on top of common base ad1c38b8 → main @ 49766cab

## 绿色 run URL（祖先线实证）

- main tip 49766cab CI 三跑全绿实证（当日本地分支基底）：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782541 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782344 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36546782634 success
- 祖先 846b2eb6（R88 同批）备录：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337984 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337659 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337504 success
- 本轮提交未外发（无 push/publish/tag——纪律内）；本地门禁终态见 .scratch/grill-round-92/reports/2026-09-30-report.md

## 票序终态

| 票 | commit (sha + but-id) | 结果 | 实证索引 |
|---|---|---|---|
| T0 哨戒+基线快照 | f2be8015 (wst) chore | ✅ | dist-tags 快照（next=0.2.0-rc.2/latest=0.2.0-rc.2 无 stable→TC 不启）+ 五件探针归档 + 基线 check/test/ship-gate 三份快照 |
| T1 判据立法 | e7a4a5c0 (xww) docs | ✅ | ADR-0093 立法（判据复用、L3b 修订、冻结项、双版措辞预注册、凭证卫生条款）+ adr/index 0093 行 |
| T2 复跑执行 | 7db133f8 (ynl) chore | ⚠️ F-bug (分支 C) | L3a established（dump-config 单行与 patch 路由在架）；L3b 与 L3c-min 因上游服务异常 not-established；泄漏探针 passed；双工件落盘 |
| T3 README 对齐 | — docs | ⏭ 条件未达未启 | 判词为 F-bug（未达分支 B/降格档），依条件票纯度守则：未启不留痕（README 维持现状） |
| T4 readme-token 接线 | c105f9e6 (vwo) fix | ✅ | `scripts/ship-gate.mjs` 接线 `readme-token-pin` 检查器（两拍节奏第二拍）+ shadow dry-run 验证与证据归档 |
| T5 deprecate 尝试 | 5f9ab5e5 (kuw) chore | ℹ️ 尝试完毕 / 权限受限 | 6 版本枚举+单空格目标执行尝试；遇 E401/E404 权限闸如实记账；closeout-claims 双态措辞预注册 |
| T6 收口件批 | 5bbc58ad (smr) docs | ✅ | ADR-0093 完成体 + CONTEXT 5 词引用锚 + registry 更态 + closeout-claims 7 项 + 轮报 + 终态戳 + CHANGELOG |
| T7 门禁+审计 | — | ✅ | pnpm -r check exit 0 / pnpm -r test exit 0 / ship-gate --quick 全闭环 |
| TC 条件票 | — | ⏭ 未触发 | T0 观测无 0.2.0 stable 晋升，一次定死不启 |

注：but-id 列（wst/xww/ynl/vwo/kuw/smr）为唯一稳定锚；sha 锚已统一对齐至 landed 祖先链真实 git 对象。

## 已核验的关键事实

- 宿主与插件契约在架：`dsh --version` 为 `0.1.7-rc.2`；`apps/dsh-plugin` 打包出 `anysearch-cli-dsh-plugin-0.1.0.tgz`，在 `r92-smoke` profile 下成功装册。
- 装册绿成立：`dsh --profile r92-smoke --dump-config` 证实 bundle 层单行在架且 patch 层自定义端点覆写成功（L3a established）。
- 凭证卫生与泄漏探针闭环：User-scope 安全注入 `DEEPSEEK_API_KEY`（len=67，SHA-256 前缀 `64a88ea6`），对 transcript 与 stderr grep 检测证实无敏感凭据外泄，泄漏探针 passed。
- 判词客观诚实：因 Featherless 上游模型响应异常触 4096 max-tokens 且报 `server_error: no_response`，未产出 `tool_calls`，判词如实落分支 C（F-bug），锁定 T3 条件票未启不留痕。
- 治理修补完备：`readme-token-pin` 检查器两拍节奏第二拍接线完成并完成 shadow dry-run 验证；`npm deprecate` 双空格执行尝试遇 E401/E404 如实记账；7 项 closeout-claims 全绿。

## 挂账（下轮/观察项）

1. `defer-r92-t2-featherless-upstream-f-bug`：T2 实机复跑因 Featherless 上游模型服务异常挂起 F-bug 登记，转下轮修复与模型源排查。
2. `defer-r92-readme-token-pin-machine-leg`：readme-token-pin 专属机器腿首跑显性挂账至 R93。
3. 常驻债×5 显式续期（web-interactive matrix 主体、approval-channel headless 维持生效）。
4. `npm deprecate` 待用户具备发布权限账号亲触执行。
