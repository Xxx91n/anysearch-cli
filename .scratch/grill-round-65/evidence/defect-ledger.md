# R65 defect 台账（found/fixed/deferred 三元组）

## found

| ID | 发现 | 证据 | 严重度 | 处置 |
|----|------|------|--------|------|
| F-01 | `apps/plugin` 无 bin——plugin server 须手拉 `node <npm-global>/@anysearch-cli/plugin/dist/server/index.cjs`，陌生人无启动入口 | t1: package.json bin=null；手拉成功（server-stderr.log） | 高 | T3 修（加 `ans-plugin-server` bin） |
| F-02 | `configs/*/hooks.json` 四平台模板 PreToolUse/PostToolUse 全指向 `dist/hooks/{preheat,distill}.cjs`——这两文件是**库**（导 `makePreToolUseDecision` 等，无 main/不读 stdin），照模板接线=静默 no-op，与字段名缺陷无关 | t1: `tail dist/hooks/preheat.cjs`=纯 exports；`grep process.stdin` 仅 session-start.cjs + adapters/* 命中 | 高 | T3 修（模板改指 `adapters/<host>.cjs` 单入口；codebuddy 模板新建） |
| F-03 | 四个适配器读 `stdin.event`，真实宿主（CodeBuddy/真 Claude Code）注入 `hook_event_name` → event="" → 静默 exit 0，hooks 部署即假绿 | t1: `adapters/claude.cjs:213` `stdin.event \|\| ""`；grill 文献 | 高 | T3 修（`hook_event_name ?? event`） |
| F-04 | CodeBuddy stdout 契约要求决策经 `hookSpecificOutput{permissionDecision\|additionalContext\|updatedToolOutput}` 信封；claude 适配器把 additionalContext/updatedInput/updatedToolOutput 写**顶层**（仅 permission 进信封） | t1: claude.ts 源码比对 vs CONTEXT.md Hooks Contract Parity | 中 | T3 修（新 codebuddy 适配器） |
| F-05 | `query_knowledge` 是 stub（返回 adapter=none） | grill 实录（D-003 登记不拦探针） | 低 | deferred——实录为发现 |
| F-06 | CodeBuddy headless 须先账号登录（`Authentication required. Please use /login`），mcp.json 已被拾取（日志 `allServers=[anysearch:connecting]`） | t1: cb-p1-tools.log result.error；logs/2026-09-16 | 阻塞 | 待用户登录（凭证门） |
| F-07 | 键位未供：`ANYSEARCH_API_KEY`/`ANS_LLM_BASE_URL`/`ANS_LLM_API`/`ANS_LLM_API_KEY` shell+User+Machine 三层 unset；`EXA_API_KEY` USER-SET | t1: env 存在性检查（值未印） | 阻塞 | 待用户供（凭证门，D-004） |

## fixed

| ID | 修复 | 先红证据 | 后绿证据 |
|----|------|----------|----------|
| F-01 | package.json 加 `bin.ans-plugin-server→dist/server/index.cjs` + server/index.ts 补 shebang | bin=null（t1 实物） | `pnpm build` → dist/server/index.cjs 首行 `#!/usr/bin/env node`；bin 注册待 T4 tarball 验证 |
| F-02 | 四平台 configs/*/hooks.json Pre/Post 改指 `adapters/<host>.cjs`（单入口双事件）；新增 configs/codebuddy/hooks.json（matcher+command schema，`$(npm root -g)` 解析陌生人路径）；`files` 加 `configs`（模板随包发布——原 files:["dist"] 根本不 ship 模板） | tail dist/hooks/preheat.cjs=纯库无 main | 模板实物 + codebuddy-contract 10/10 |
| F-03 | 四适配器 + session-start 改 `hook_event_name ?? event`；新 codebuddy.ts 适配器（hook_event_name+hookSpecificOutput 信封+SessionStart 原文） | t1-synthetic-stdin-red.log：hook_event_name→0 索引空输出；event→2 索引 | t3-synthetic-green-{codebuddy,claude}.log：两适配器 hook_event_name 各 +2 索引+正确信封；test/codebuddy-contract.test.ts 10/10 |
| F-04 | codebuddy.ts 决策全进 `hookSpecificOutput{permissionDecision\|additionalContext\|updatedToolOutput}`（顶层零泄漏有测试断言） | claude.ts 源码顶层写字段（t1） | codebuddy-contract.test.ts「decision keys must NOT leak to top level」断言绿 |

## deferred

- F-05 query_knowledge stub：如实入账，不修（D-003 登记）。
- OIDC trusted publishing：欠条 due 0.0.4，范围外（D-001）。
