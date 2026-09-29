# Round 90 收口 — dsh 原生工具面实施轮（dsh-native-tools-impl）

Stack: r90 stacked above r90-grill（GitButler lanes，未 land）→ main @ 846b2eb6

## 绿色 run URL（祖先线实证）

- main tip CI 三跑观测（R89 同批次，commit 祖先 846b2eb6 可解）：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337984 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337659 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337504 success
- 本轮提交未外发（无 push/publish/tag——纪律内）；本地门禁终态见 reports/2026-09-29-report.md + evidence/t7-ship-gate.log

## 票序终态

| 票 | commit (sha+稳定 but id；amend 下 sha 滚动以 git log 为准) | 结果 | 实证 |
|---|---|---|---|
| T0 哨戒+基线 | 4c581738 (but id puz) chore | ✅ | t0-dist-tags.json（next=0.2.0-rc.1 无 stable→TC 不启）+t0-baseline.log（check/test 全绿，ship-gate 仅 clean-tree 中态红） |
| T1 spec-gap 补行 | 358364b5 (but id qum) docs | ✅ | ADR-0090 addendum：pending-repin 第四行+版本轴/消费轴正交 |
| T2 expected-RED | d2e9b587 (but id vok) test | ✅ | t2-expected-red.log：预实施 15 pass/6 fail（六断言腿红） |
| T3 原生注册实施 | 1bc7b84d (but id yvp) fix | ✅ | 五 ans_* ctx.tools.register 裸 ToolDefinition；KernelJsonSchemas 逐字投影；callServer→/mcp 握手缓存+三头+fail-open；t3-green.log 21/21 |
| T4 桥退役 | b41469e1 (but id mnt) refactor | ✅ | cordis.patch.yml 插件行独存；ship-gate step-1s 断言同票进化（rollback=revert 对称）；测试改名 9 处 |
| T5 matrix 复核 | 25417dff (but id rqu) docs | ✅ | approval-channel 拆票（tarball 复验在架）；matrix 收窄维持 defer；native-tools→closed |
| T6 收口件批 | 4df88951 (but id xvx) docs | ✅ | ADR-0091+index 0091 行+CONTEXT 两词块+closeout-claims 8 项+终态戳+CHANGELOG r90 段 |
| T7 门禁+实测 | 455feed5 (but id wps) chore | ✅ | 双进程测活+/health+真 execute 链路+pack+ship-gate --quick 全绿 |
| TC 条件票 | — | ⏭ 未触发 | dist-tags 复观无 0.2.0 stable 晋升 |

## 已核验的关键事实

- 原生面实跑：built lib/index.js 经 mock-ctx apply()→五 ans_* 注册；execute→ans-mcp :39999 真实 initialize+notifications/initialized+tools/call 往返，recall_memory 回真实记忆命中（hitsCount=5）、search_web 回 canonical JSON。
- 立法偏离记档：defineTool（运行时值，导入破零依赖契约）→ 裸 ToolDefinition（同一 register 契约；DSL 无法表达 additionalProperties:false/minLength，KernelJsonSchemas 逐字投影为零损单源）。
- callServer 加性三槽（headers/timeoutMs/signal）+空体 2xx→{}——既有 hooks 调用点行为零变。
- bundle 卫生：148.7KB，external=node:crypto/fs/module/path 仅四件，better-sqlite3 零泄漏（kernel 叶导出旁路 barrel）。
- dsh 原生裸名 ans_* 已被 isAnsTool 后缀正则命中——钩子四面契约零改动生效。

## 挂账（下轮/观察项）

- 0.2.0 stable 晋升目击→TC 条件票（L1+判词+收口）再启。
- defer-r72-dsh-approval-channel 可独立前置（上游依赖已解除，剩交互实测成本）。
- defer-r72-dsh-web-interactive-matrix（patchReload:live+browser-turn）维持 defer 等上游出面。
- 真宿主冒烟（dsh --profile 实跑原生工具调）未在本轮做——mock-Cordis 注册路径+真 MCP 链路已双端实证，实机 L3 留待宿主侧彩排票。

## 下一次 grill 方向（候选，未立项）

1. approval-channel 交互面验证轮（defer-r72-dsh-approval-channel，上游已具备）。
2. dsh 0.2.0 stable 晋升目击→收口探针。
3. 原生工具面 dsh 实机冒烟（L3 profile 彩排）。
