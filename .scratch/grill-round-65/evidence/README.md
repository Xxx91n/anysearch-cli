# R65 evidence 索引（T1 完成态 2026-09-16）

## T1 部署腿证据（D-001/D-002/D-004）

| 步骤 | 命令 | 结果 | 证据文件 |
|------|------|------|----------|
| 安装 | `npm i -g @anysearch-cli/cli@0.0.3 @anysearch-cli/mcp@0.0.3 @anysearch-cli/plugin@0.0.3` | added 340 packages, 0 err | t1-npm-install.log |
| 版本 | `ans --version` | `0.0.3` | t1-ans-version.log |
| doctor(repo cwd) | `ans doctor` | 22 pass/3 skip/0 fail；domains 解析到 `domains`（cwd 链） | t1-ans-doctor.log |
| doctor(stranger cwd) | `cd D:\Aworker\e2e-r65-codebuddy && ans doctor` | 22/3/0；domains 解析到 `<npm-global>\@anysearch-cli\cli\domains`（包装域随包） | t1-ans-doctor-stranger.log | <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->
| 演示域 | `ans domain docs` | persisted → `~/.anysearch/config.env`；sources=tavily,exa,anysearch | t1-domain-docs.log |
| env 键存在性 | ctx node 三层查（shell/User/Machine） | EXA_API_KEY=USER-SET；ANYSEARCH_API_KEY、ANS_LLM_* 全 unset（值未印） | 会话记录 |
| MCP tools/list | `node scripts/mcp-tools-list.mjs`（spawn node+dist 直拉） | initOk；5 工具 search_web/research_web/recall_memory/query_knowledge/ans_chat；serverInfo anysearch@0.0.3 | t1-ans-mcp-tools-list.log |
| plugin server 手拉 | `node <npm-global>/@anysearch-cli/plugin/dist/server/index.cjs`（cwd=e2e） | listen 127.0.0.1:33333；token 0600 落 `<cwd>/.anysearch-cli/server-token` | server-stderr.log |
| /health 无 token | `curl :33333/health` | HTTP 401 unauthorized | 会话记录 |
| /health +Bearer | ctx node http | HTTP 200 `{"status":"ok"}` | 会话记录 |
| e2e 现场 | `D:\Aworker\e2e-r65-codebuddy\` 建 `.codebuddy/settings.json`（claude 适配器试接）+ `mcp.json`（env 空块=子进程继承） | 文件落盘 | e2e 现场 | <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->
| CodeBuddy headless 探路 | `codebuddy -p ... --output-format stream-json --mcp-config mcp.json --strict-mcp-config` | mcp.json 拾取（`allServers=[anysearch:connecting]`）；**Authentication required** 中止 | cb-p1-tools.log |
| 合成 stdin 红绿对照 | `node scripts/synthetic-stdin-red.mjs`（cwd=e2e，server 活） | **RED 实证**：`hook_event_name`→exit0/空 stdout/0 索引；`event`→distilled 输出/2 索引 | t1-synthetic-stdin-red.log |

## 部署缺口清单（初稿，详见 defect-ledger.md）

1. plugin 无 bin → server 手拉（F-01）
2. 四平台 hooks.json 模板指库文件非适配器入口（F-02，新发现，grill 未登记）
3. 适配器读 `event` 非 `hook_event_name`（F-03，合成红实证）
4. stdout 信封顶层 vs hookSpecificOutput（F-04）
5. query_knowledge stub（F-05 deferred）
6. CodeBuddy 须先登录（F-06 凭证门）
7. ANYSEARCH_API_KEY/ANS_LLM_* 未供（F-07 凭证门）

## T3 修复后绿证据 + T4 ship 通道 + T6 门禁（同日补录）

| 步骤 | 命令 | 结果 | 证据文件 |
|------|------|------|----------|
| 合成绿 codebuddy | `ANS_ADAPTER=<repo>/dist/hooks/adapters/codebuddy.cjs node scripts/synthetic-stdin-red.mjs` | hook_event_name→hookSpecificOutput 信封 + +2 索引；event 兜底同绿 | t3-synthetic-green-codebuddy.log |
| 合成绿 claude(修复) | 同上 ANS_ADAPTER=claude.cjs | hook_event_name→顶层 updatedToolOutput + +2 索引 | t3-synthetic-green-claude.log |
| 契约单测 | `pnpm --filter @anysearch-cli/plugin test` | codebuddy-contract 20/20（五平台入口+数组形状+模板target断言） | pnpm test 输出 |
| pnpm pack | `pnpm --filter @anysearch-cli/plugin pack` | tgz 含 configs/5 平台 + codebuddy.cjs + server/index.cjs | ship-gate pack 清单 |
| tarball 装 | `npm i -g ./anysearch-cli-plugin-0.0.3.tgz` | changed 3 packages；configs+codebuddy.cjs 落 npm-global | 会话记录 |
| bin 测活 | `ans-plugin-server`（cwd=e2e） | /health 401→200，复用 0600 token | 会话记录 |
| ship-gate | `node scripts/ship-gate.mjs --skip-matrix` | 9/9 步全 pass（memory-eval 126/126、MCP init、fail-open boot） | t6-ship-gate.log |
| CLI 实检索 | `ans search "modelcontextprotocol specification" --json`（EXA） | 结果全落 docs 域 allowlist 宿主 | t1-ans-search-exa.log |
| OOD 观察 | `ans search "cookie recipe" --json` | 10 结果全 allowlist + abstain=null + sufficiency=ambiguous（域过滤≠主题 abstain，P3 再验） | t1-ans-search-abstain.log |

## 键位纪律

所有证据文件不含键值；token 文件 0600 仅被脚本读取未打印；mcp.json env 空块靠继承。

## T2/T4 live 探针矩阵（CodeBuddy 2.151.0 headless，model=fast-model，e2e=D:\Aworker\e2e-r65-codebuddy） <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->

跑器：`node scripts/probe.mjs <label> "<prompt>" [--nomcp] [--maxturns N] [--model M]`（自动注入 User 级 env，值不落盘）；直调 `node scripts/mcp-call-tool.mjs <tool> '<args>'`。

| 探针 | 结果 | 证据 |
|------|------|------|
| P1 注册 | init.mcp_servers=[anysearch:connected] + 5 工具 | t2-p1-tools.stream.jsonl |
| P2 域内 | typescriptlang.org 实答；索引 6→16 | t2-p2b-indomain-fixed.* |
| P3 OOD | 修复前通用食谱结果 → 修复后全 modelcontextprotocol.io | t2-p3-ood-abstain.* / t2-p3b-ood-domain.* |
| P4 ans_chat | v1/chat step 模型真实回答 | t2-p4d-ans-chat.*（红证据 p4/p4b/p4c 同前缀） |
| P5 recall | 10 条跨 3 sessionId | t2-p5-recall.* |
| P6 hooks | SessionStart 卡入 context/Pre+Post exit0/信封合法 | ~/.codebuddy/debug/<sid>.txt（不落库，宿主侧文件） |
| P7 fail-open | server 死→search 正常+hooks exit0+distill 仍产出 | t2-p7-failopen.* |
| P8 组合 | research 执行；query_knowledge adapter=none 诚实 | t2-p8-research-knowledge.* |
| P9 对照 | 无工具错引 vs 有工具 pnpm.io/settings/node-modules 真页 | t2-p9a-nomcp / t2-p9b-withtools |

## F-09..F-12 live 抓出缺陷（详 defect-ledger.md，全部已修）

F-09 数组 tool_response→distill 0 假绿 / F-10 mcp 不 ship domains→域向全灭 / F-11 ans_chat 不读 LLM 端点三件套 / F-12 pi-runtime 等不存在 "text" 事件→空正文。
