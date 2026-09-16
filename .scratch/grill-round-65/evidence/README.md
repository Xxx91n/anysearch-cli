# R65 evidence 索引（T1 完成态 2026-09-16）

## T1 部署腿证据（D-001/D-002/D-004）

| 步骤 | 命令 | 结果 | 证据文件 |
|------|------|------|----------|
| 安装 | `npm i -g @anysearch-cli/cli@0.0.3 @anysearch-cli/mcp@0.0.3 @anysearch-cli/plugin@0.0.3` | added 340 packages, 0 err | t1-npm-install.log |
| 版本 | `ans --version` | `0.0.3` | t1-ans-version.log |
| doctor(repo cwd) | `ans doctor` | 22 pass/3 skip/0 fail；domains 解析到 `D:\Aworker\anysearch-cli\domains`（cwd 链） | t1-ans-doctor.log |
| doctor(stranger cwd) | `cd D:\Aworker\e2e-r65-codebuddy && ans doctor` | 22/3/0；domains 解析到 `<npm-global>\@anysearch-cli\cli\domains`（包装域随包） | t1-ans-doctor-stranger.log |
| 演示域 | `ans domain docs` | persisted → `~/.anysearch/config.env`；sources=tavily,exa,anysearch | t1-domain-docs.log |
| env 键存在性 | ctx node 三层查（shell/User/Machine） | EXA_API_KEY=USER-SET；ANYSEARCH_API_KEY、ANS_LLM_* 全 unset（值未印） | 会话记录 |
| MCP tools/list | `node scripts/mcp-tools-list.mjs`（spawn node+dist 直拉） | initOk；5 工具 search_web/research_web/recall_memory/query_knowledge/ans_chat；serverInfo anysearch@0.0.3 | t1-ans-mcp-tools-list.log |
| plugin server 手拉 | `node <npm-global>/@anysearch-cli/plugin/dist/server/index.cjs`（cwd=e2e） | listen 127.0.0.1:33333；token 0600 落 `<cwd>/.anysearch-cli/server-token` | server-stderr.log |
| /health 无 token | `curl :33333/health` | HTTP 401 unauthorized | 会话记录 |
| /health +Bearer | ctx node http | HTTP 200 `{"status":"ok"}` | 会话记录 |
| e2e 现场 | `D:\Aworker\e2e-r65-codebuddy\` 建 `.codebuddy/settings.json`（claude 适配器试接）+ `mcp.json`（env 空块=子进程继承） | 文件落盘 | e2e 现场 |
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
| 契约单测 | `pnpm --filter @anysearch-cli/plugin test` | codebuddy-contract 14/14（五平台入口各覆盖） | pnpm test 输出 |
| pnpm pack | `pnpm --filter @anysearch-cli/plugin pack` | tgz 含 configs/5 平台 + codebuddy.cjs + server/index.cjs | ship-gate pack 清单 |
| tarball 装 | `npm i -g ./anysearch-cli-plugin-0.0.3.tgz` | changed 3 packages；configs+codebuddy.cjs 落 npm-global | 会话记录 |
| bin 测活 | `ans-plugin-server`（cwd=e2e） | /health 401→200，复用 0600 token | 会话记录 |
| ship-gate | `node scripts/ship-gate.mjs --skip-matrix` | 9/9 步全 pass（memory-eval 126/126、MCP init、fail-open boot） | t6-ship-gate.log |
| CLI 实检索 | `ans search "modelcontextprotocol specification" --json`（EXA） | 结果全落 docs 域 allowlist 宿主 | t1-ans-search-exa.log |
| OOD 观察 | `ans search "cookie recipe" --json` | 10 结果全 allowlist + abstain=null + sufficiency=ambiguous（域过滤≠主题 abstain，P3 再验） | t1-ans-search-abstain.log |

## 键位纪律

所有证据文件不含键值；token 文件 0600 仅被脚本读取未打印；mcp.json env 空块靠继承。
